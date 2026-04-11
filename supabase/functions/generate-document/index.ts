import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const { document_id, format = "pdf", parsed_content, template, document_type } = body;

    if (!document_id && !parsed_content) throw new Error("document_id or parsed_content is required");
    if (!["pdf", "docx"].includes(format)) throw new Error("format must be 'pdf' or 'docx'");

    let doc: any = null;

    if (parsed_content) {
      // Direct content mode (from CVTemplateSelector / master_documents)
      doc = {
        content: parsed_content,
        document_type: document_type || "cv",
        jobs: null,
      };
    } else {
      // Lookup from tailored_documents
      const { data: tailoredDoc, error: docError } = await supabase
        .from("tailored_documents")
        .select("*, jobs(title, company)")
        .eq("id", document_id)
        .eq("user_id", user.id)
        .single();

      if (docError || !tailoredDoc) throw new Error("Document not found");
      doc = tailoredDoc;
    }

    const { data: dbProfile } = await supabase
      .from("profiles_v2")
      .select("full_name, email, phone, linkedin_url, location")
      .eq("user_id", user.id)
      .single();

    const rawContent = doc.content as any;
    const isCoverLetter = doc.document_type === "cover_letter";
    const jobTitle = (doc as any).jobs?.title || "Position";
    const company = (doc as any).jobs?.company || "Company";

    // Normalize field names: parsed_content uses "employment", generator expects "experience"
    // Also map "achievements" to "highlights" per entry
    const experience = (rawContent?.experience || rawContent?.employment || []).map((e: any) => ({
      ...e,
      highlights: e.highlights || e.achievements || [],
    }));
    const education = rawContent?.education || [];
    const certifications = rawContent?.certifications || [];

    const content = {
      ...rawContent,
      experience,
      education,
      certifications,
    };

    // For direct parsed_content mode, use embedded contact info; fall back to profile
    const profile = {
      full_name: rawContent?.full_name || dbProfile?.full_name || "Candidate",
      email: rawContent?.email || dbProfile?.email,
      phone: rawContent?.phone || dbProfile?.phone,
      location: rawContent?.location || dbProfile?.location,
      linkedin_url: rawContent?.linkedin_url || dbProfile?.linkedin_url,
    };
    const candidateName = profile.full_name;

    let fileBuffer: Uint8Array;
    let mimeType: string;
    let fileName: string;

    if (format === "pdf") {
      fileBuffer = generatePDF(content, isCoverLetter, candidateName, profile, jobTitle, company);
      mimeType = "application/pdf";
      fileName = `${isCoverLetter ? "Cover_Letter" : "CV"}_${company.replace(/\s+/g, "_")}.pdf`;
    } else {
      fileBuffer = generateDOCX(content, isCoverLetter, candidateName, profile, jobTitle, company);
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      fileName = `${isCoverLetter ? "Cover_Letter" : "CV"}_${company.replace(/\s+/g, "_")}.docx`;
    }

    return new Response(fileBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    console.error("generate-document error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status || 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── PDF Generation (manual PDF construction) ──

function generatePDF(
  content: any,
  isCoverLetter: boolean,
  name: string,
  profile: any,
  jobTitle: string,
  company: string
): Uint8Array {
  const lines: string[] = [];
  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 50;
  const lineHeight = 14;
  const maxLineWidth = pageWidth - 2 * margin;

  if (isCoverLetter) {
    const text = typeof content === "string" ? content : content?.content || JSON.stringify(content);
    lines.push(`__BOLD__${name}__ENDBOLD__`);
    if (profile?.email) lines.push(profile.email);
    if (profile?.phone) lines.push(profile.phone);
    if (profile?.location) lines.push(profile.location);
    lines.push("");
    lines.push(`Re: ${jobTitle} at ${company}`);
    lines.push("");
    const paragraphs = text.split(/\n\n|\n/);
    for (const p of paragraphs) {
      const wrapped = wrapText(p.trim(), 90);
      lines.push(...wrapped);
      lines.push("");
    }
  } else {
    // CV
    lines.push(`__BOLD__${name}__ENDBOLD__`);
    if (content?.headline) lines.push(content.headline);
    const contactParts: string[] = [];
    if (profile?.email) contactParts.push(profile.email);
    if (profile?.phone) contactParts.push(profile.phone);
    if (profile?.location) contactParts.push(profile.location);
    if (profile?.linkedin_url) contactParts.push(profile.linkedin_url);
    if (contactParts.length) lines.push(contactParts.join(" | "));
    lines.push("__LINE__");

    if (content?.summary) {
      lines.push("");
      lines.push("__BOLD__PROFESSIONAL SUMMARY__ENDBOLD__");
      lines.push("__LINE__");
      const wrapped = wrapText(content.summary, 90);
      lines.push(...wrapped);
    }

    if (content?.experience?.length) {
      lines.push("");
      lines.push("__BOLD__EXPERIENCE__ENDBOLD__");
      lines.push("__LINE__");
      for (const exp of content.experience) {
        lines.push("");
        lines.push(`__BOLD__${exp.title}__ENDBOLD__ — ${exp.company}`);
        if (exp.location) lines.push(exp.location);
        lines.push(`${exp.start_date || ""} – ${exp.is_current ? "Present" : exp.end_date || "N/A"}`);
        if (exp.highlights?.length) {
          for (const h of exp.highlights) {
            const wrapped = wrapText(`• ${h}`, 85);
            lines.push(...wrapped);
          }
        }
      }
    }

    if (content?.education?.length) {
      lines.push("");
      lines.push("__BOLD__EDUCATION__ENDBOLD__");
      lines.push("__LINE__");
      for (const edu of content.education) {
        lines.push("");
        lines.push(`__BOLD__${edu.degree}__ENDBOLD__${edu.field_of_study ? ` — ${edu.field_of_study}` : ""}`);
        lines.push(edu.institution || "");
        if (edu.start_date || edu.end_date) {
          lines.push(`${edu.start_date || ""} – ${edu.end_date || "Present"}`);
        }
        if (edu.gpa) lines.push(`GPA: ${edu.gpa}`);
      }
    }

    if (content?.skills?.length) {
      lines.push("");
      lines.push("__BOLD__SKILLS__ENDBOLD__");
      lines.push("__LINE__");
      const wrapped = wrapText(content.skills.join(", "), 90);
      lines.push(...wrapped);
    }

    if (content?.certifications?.length) {
      lines.push("");
      lines.push("__BOLD__CERTIFICATIONS__ENDBOLD__");
      lines.push("__LINE__");
      for (const cert of content.certifications) {
        lines.push(`• ${cert.name}${cert.issuing_organization ? ` — ${cert.issuing_organization}` : ""}`);
      }
    }
  }

  return buildPDFBytes(lines, pageWidth, pageHeight, margin, lineHeight);
}

function wrapText(text: string, maxChars: number): string[] {
  if (!text) return [""];
  const words = text.split(" ");
  const result: string[] = [];
  let currentLine = "";
  for (const word of words) {
    if ((currentLine + " " + word).trim().length > maxChars) {
      if (currentLine) result.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + " " + word : word;
    }
  }
  if (currentLine) result.push(currentLine);
  return result.length ? result : [""];
}

function buildPDFBytes(
  lines: string[],
  pageWidth: number,
  pageHeight: number,
  margin: number,
  lineHeight: number
): Uint8Array {
  // Simple PDF 1.4 construction
  const pages: string[][] = [];
  let currentPage: string[] = [];
  let y = pageHeight - margin;

  for (const line of lines) {
    if (y < margin + lineHeight) {
      pages.push(currentPage);
      currentPage = [];
      y = pageHeight - margin;
    }
    currentPage.push(line);
    y -= lineHeight;
  }
  if (currentPage.length) pages.push(currentPage);

  const objects: string[] = [];
  let objCount = 0;

  const addObj = (content: string): number => {
    objCount++;
    objects.push(`${objCount} 0 obj\n${content}\nendobj`);
    return objCount;
  };

  // 1: Catalog
  addObj("<< /Type /Catalog /Pages 2 0 R >>");

  // 2: Pages (placeholder, update later)
  const pagesObjIndex = objects.length;
  addObj(""); // placeholder

  // 3: Font
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  // 4: Bold Font
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  const pageObjIds: number[] = [];

  for (const pageLines of pages) {
    let streamContent = "";
    let cy = pageHeight - margin;

    for (const line of pageLines) {
      if (line === "__LINE__") {
        streamContent += `${margin} ${cy - 2} m ${pageWidth - margin} ${cy - 2} l S\n`;
        cy -= lineHeight * 0.5;
        continue;
      }

      if (line === "") {
        cy -= lineHeight * 0.5;
        continue;
      }

      const isBold = line.includes("__BOLD__");
      const cleanLine = line.replace(/__BOLD__/g, "").replace(/__ENDBOLD__/g, "");
      const escaped = escapePDF(cleanLine);

      if (isBold) {
        streamContent += `BT /F2 ${cleanLine === cleanLine.toUpperCase() && cleanLine.length < 40 ? 12 : 14} Tf ${margin} ${cy} Td (${escaped}) Tj ET\n`;
      } else {
        streamContent += `BT /F1 10 Tf ${margin} ${cy} Td (${escaped}) Tj ET\n`;
      }
      cy -= lineHeight;
    }

    const stream = `q\n0.2 0.2 0.2 rg\n${streamContent}Q`;
    const streamObjId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

    const pageObjId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Contents ${streamObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
    );
    pageObjIds.push(pageObjId);
  }

  // Update pages object
  const kids = pageObjIds.map(id => `${id} 0 R`).join(" ");
  objects[pagesObjIndex] = `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageObjIds.length} >>\nendobj`;

  // Build final PDF
  const header = "%PDF-1.4\n";
  let body = "";
  const offsets: number[] = [];

  for (const obj of objects) {
    offsets.push(header.length + body.length);
    body += obj + "\n";
  }

  const xrefOffset = header.length + body.length;
  let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const pdfString = header + body + xref + trailer;

  return new TextEncoder().encode(pdfString);
}

function escapePDF(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// ── DOCX Generation (minimal OOXML) ──

function generateDOCX(
  content: any,
  isCoverLetter: boolean,
  name: string,
  profile: any,
  jobTitle: string,
  company: string
): Uint8Array {
  const paragraphs: string[] = [];

  const p = (text: string, bold = false, size = 22) => {
    const rPr = `<w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>`;
    const escaped = escapeXML(text);
    paragraphs.push(`<w:p><w:r>${rPr}<w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`);
  };

  const hr = () => {
    paragraphs.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>`);
  };

  if (isCoverLetter) {
    p(name, true, 28);
    if (profile?.email) p(profile.email, false, 20);
    if (profile?.phone) p(profile.phone, false, 20);
    if (profile?.location) p(profile.location, false, 20);
    paragraphs.push("<w:p/>");
    p(`Re: ${jobTitle} at ${company}`, true, 22);
    paragraphs.push("<w:p/>");
    const text = typeof content === "string" ? content : content?.content || JSON.stringify(content);
    for (const para of text.split(/\n\n|\n/)) {
      if (para.trim()) p(para.trim());
      else paragraphs.push("<w:p/>");
    }
  } else {
    p(name, true, 32);
    if (content?.headline) p(content.headline, false, 22);
    const contactParts: string[] = [];
    if (profile?.email) contactParts.push(profile.email);
    if (profile?.phone) contactParts.push(profile.phone);
    if (profile?.location) contactParts.push(profile.location);
    if (profile?.linkedin_url) contactParts.push(profile.linkedin_url);
    if (contactParts.length) p(contactParts.join(" | "), false, 20);
    hr();

    if (content?.summary) {
      p("PROFESSIONAL SUMMARY", true, 24);
      hr();
      p(content.summary);
      paragraphs.push("<w:p/>");
    }

    if (content?.experience?.length) {
      p("EXPERIENCE", true, 24);
      hr();
      for (const exp of content.experience) {
        p(`${exp.title} — ${exp.company}`, true, 22);
        if (exp.location) p(exp.location, false, 18);
        p(`${exp.start_date || ""} – ${exp.is_current ? "Present" : exp.end_date || "N/A"}`, false, 20);
        if (exp.highlights?.length) {
          for (const h of exp.highlights) {
            p(`• ${h}`, false, 20);
          }
        }
        paragraphs.push("<w:p/>");
      }
    }

    if (content?.education?.length) {
      p("EDUCATION", true, 24);
      hr();
      for (const edu of content.education) {
        p(`${edu.degree}${edu.field_of_study ? ` — ${edu.field_of_study}` : ""}`, true, 22);
        p(edu.institution || "", false, 20);
        if (edu.start_date || edu.end_date) {
          p(`${edu.start_date || ""} – ${edu.end_date || "Present"}`, false, 18);
        }
        if (edu.gpa) p(`GPA: ${edu.gpa}`, false, 18);
        paragraphs.push("<w:p/>");
      }
    }

    if (content?.skills?.length) {
      p("SKILLS", true, 24);
      hr();
      p(content.skills.join(", "));
    }

    if (content?.certifications?.length) {
      p("CERTIFICATIONS", true, 24);
      hr();
      for (const cert of content.certifications) {
        p(`• ${cert.name}${cert.issuing_organization ? ` — ${cert.issuing_organization}` : ""}`, false, 20);
      }
    }
  }

  return buildDOCXBytes(paragraphs);
}

function buildDOCXBytes(paragraphs: string[]): Uint8Array {
  // Build minimal OOXML docx as a ZIP
  const contentTypesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const wordRelsXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const documentXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
xmlns:mo="http://schemas.microsoft.com/office/mac/office/2008/main"
xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
xmlns:mv="urn:schemas-microsoft-com:mac:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
xmlns:w10="urn:schemas-microsoft-com:office:word"
xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml">
<w:body>
${paragraphs.join("\n")}
<w:sectPr>
<w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;

  // Build ZIP manually (minimal ZIP format)
  const files: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: new TextEncoder().encode(contentTypesXML) },
    { name: "_rels/.rels", data: new TextEncoder().encode(relsXML) },
    { name: "word/_rels/document.xml.rels", data: new TextEncoder().encode(wordRelsXML) },
    { name: "word/document.xml", data: new TextEncoder().encode(documentXML) },
  ];

  return buildZIP(files);
}

function buildZIP(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const entries: { name: Uint8Array; data: Uint8Array; offset: number }[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);

    // Local file header
    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true); // signature
    hv.setUint16(4, 20, true); // version needed
    hv.setUint16(6, 0, true); // flags
    hv.setUint16(8, 0, true); // compression: stored
    hv.setUint16(10, 0, true); // mod time
    hv.setUint16(12, 0, true); // mod date
    hv.setUint32(14, crc, true);
    hv.setUint32(18, file.data.length, true); // compressed size
    hv.setUint32(22, file.data.length, true); // uncompressed size
    hv.setUint16(26, nameBytes.length, true);
    hv.setUint16(28, 0, true); // extra field length
    header.set(nameBytes, 30);

    entries.push({ name: nameBytes, data: file.data, offset });
    chunks.push(header, file.data);
    offset += header.length + file.data.length;
  }

  // Central directory
  const centralStart = offset;
  for (const entry of entries) {
    const cd = new Uint8Array(46 + entry.name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // compression
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, 0, true); // mod date
    const crc = crc32(entry.data);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, entry.name.length, true);
    cv.setUint16(30, 0, true); // extra field
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, entry.offset, true);
    cd.set(entry.name, 46);
    chunks.push(cd);
    offset += cd.length;
  }

  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // central dir disk
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, offset - centralStart, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);
  chunks.push(eocd);

  // Concatenate
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function escapeXML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
