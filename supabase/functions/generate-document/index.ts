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
    const { document_id, format = "pdf", parsed_content, template = "classic", document_type } = body;

    if (!document_id && !parsed_content) throw new Error("document_id or parsed_content is required");
    if (!["pdf", "docx"].includes(format)) throw new Error("format must be 'pdf' or 'docx'");

    let doc: any = null;

    if (parsed_content) {
      doc = { content: parsed_content, document_type: document_type || "cv", jobs: null };
    } else {
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

    const formatDate = (d: string | null | undefined): string => {
      if (!d) return "";
      // DD/MM/YYYY or DD-MM-YYYY
      const dmy = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (dmy) {
        let [, day, m, y] = dmy;
        let yearNum = parseInt(y);
        if (yearNum < 100) yearNum += 2000;
        const monthNum = parseInt(m);
        if (monthNum < 1 || monthNum > 12) return d;
        const date = new Date(Date.UTC(yearNum, monthNum - 1, parseInt(day)));
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
      }
      // ISO YYYY-MM-DD
      const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) {
        const date = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
      }
      return d;
    };

    const experience = (rawContent?.experience || rawContent?.employment || []).map((e: any) => ({
      ...e,
      highlights: e.highlights || e.achievements || [],
      start_date: formatDate(e.start_date),
      end_date: formatDate(e.end_date),
    }));
    const education = (rawContent?.education || []).map((e: any) => ({
      ...e,
      start_date: formatDate(e.start_date),
      end_date: formatDate(e.end_date),
    }));
    const certifications = rawContent?.certifications || [];

    const content = { ...rawContent, experience, education, certifications };

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
      fileBuffer = generatePDF(content, isCoverLetter, candidateName, profile, jobTitle, company, template);
      mimeType = "application/pdf";
      fileName = `${isCoverLetter ? "Cover_Letter" : "CV"}_${template}_${company.replace(/\s+/g, "_")}.pdf`;
    } else {
      fileBuffer = generateDOCX(content, isCoverLetter, candidateName, profile, jobTitle, company, template);
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      fileName = `${isCoverLetter ? "Cover_Letter" : "CV"}_${template}_${company.replace(/\s+/g, "_")}.docx`;
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

// ── Template color configs ──
interface TemplateStyle {
  headingColor: string;    // RGB 0-1 for PDF
  accentColor: string;     // hex for DOCX
  bodyFont: string;
  headingFont: string;
  nameSize: number;
  headingSize: number;
  bodySize: number;
  sectionSep: "line" | "space" | "double-line";
  headingCase: "upper" | "title";
}

const TEMPLATE_STYLES: Record<string, TemplateStyle> = {
  classic: {
    headingColor: "0.15 0.15 0.15",
    accentColor: "333333",
    bodyFont: "Helvetica",
    headingFont: "Helvetica-Bold",
    nameSize: 28,
    headingSize: 13,
    bodySize: 10,
    sectionSep: "line",
    headingCase: "upper",
  },
  modern: {
    headingColor: "0.11 0.38 0.65",
    accentColor: "1C60A6",
    bodyFont: "Helvetica",
    headingFont: "Helvetica-Bold",
    nameSize: 30,
    headingSize: 14,
    bodySize: 10,
    sectionSep: "double-line",
    headingCase: "upper",
  },
  executive: {
    headingColor: "0.25 0.14 0.08",
    accentColor: "3F2412",
    bodyFont: "Times-Roman",
    headingFont: "Times-Bold",
    nameSize: 32,
    headingSize: 13,
    bodySize: 11,
    sectionSep: "line",
    headingCase: "title",
  },
  minimal: {
    headingColor: "0.2 0.2 0.2",
    accentColor: "444444",
    bodyFont: "Helvetica",
    headingFont: "Helvetica-Bold",
    nameSize: 24,
    headingSize: 11,
    bodySize: 10,
    sectionSep: "space",
    headingCase: "upper",
  },
};

function getStyle(template: string): TemplateStyle {
  return TEMPLATE_STYLES[template] || TEMPLATE_STYLES.classic;
}

// ── PDF Generation ──

function generatePDF(
  content: any,
  isCoverLetter: boolean,
  name: string,
  profile: any,
  jobTitle: string,
  company: string,
  template: string
): Uint8Array {
  const style = getStyle(template);
  const lines: { text: string; bold?: boolean; size?: number; color?: string; isSep?: string; indent?: number }[] = [];
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = template === "executive" ? 60 : template === "modern" ? 45 : 50;

  const addLine = (text: string, bold = false, size?: number, indent = 0) => {
    lines.push({ text, bold, size: size || style.bodySize, indent });
  };
  const addSep = () => {
    lines.push({ text: "", isSep: style.sectionSep, size: 0 });
  };
  const addBlank = () => {
    lines.push({ text: "", size: style.bodySize * 0.5 });
  };

  const formatHeading = (text: string): string => {
    return style.headingCase === "upper" ? text.toUpperCase() : text;
  };

  if (isCoverLetter) {
    addLine(name, true, style.nameSize);
    if (profile?.email) addLine(profile.email);
    if (profile?.phone) addLine(profile.phone);
    if (profile?.location) addLine(profile.location);
    addBlank();
    addLine(`Re: ${jobTitle} at ${company}`, true, style.headingSize);
    addBlank();
    const text = typeof content === "string" ? content : content?.content || JSON.stringify(content);
    for (const para of text.split(/\n\n|\n/)) {
      if (para.trim()) {
        for (const wl of wrapText(para.trim(), 90)) addLine(wl);
      }
      addBlank();
    }
  } else {
    // Name
    addLine(name, true, style.nameSize);
    // Headline
    if (content?.headline) addLine(content.headline, false, style.bodySize + 2);
    // Contact
    const contactParts: string[] = [];
    if (profile?.email) contactParts.push(profile.email);
    if (profile?.phone) contactParts.push(profile.phone);
    if (profile?.location) contactParts.push(profile.location);
    if (profile?.linkedin_url) contactParts.push(profile.linkedin_url);
    if (contactParts.length) addLine(contactParts.join(template === "modern" ? "  •  " : "  |  "), false, 9);
    addSep();

    // Summary
    if (content?.summary) {
      addBlank();
      addLine(formatHeading("Professional Summary"), true, style.headingSize);
      addSep();
      for (const wl of wrapText(content.summary, 90)) addLine(wl);
    }

    // Experience
    if (content?.experience?.length) {
      addBlank();
      addLine(formatHeading("Experience"), true, style.headingSize);
      addSep();
      for (const exp of content.experience) {
        addBlank();
        addLine(`${exp.title} — ${exp.company}`, true, style.bodySize + 1);
        const dateLine = `${exp.start_date || ""} – ${exp.is_current ? "Present" : exp.end_date || ""}`;
        if (exp.location) addLine(`${exp.location}  |  ${dateLine}`, false, 9);
        else addLine(dateLine, false, 9);
        if (exp.highlights?.length) {
          for (const h of exp.highlights) {
            for (const wl of wrapText(`• ${h}`, 85)) addLine(wl, false, style.bodySize, 10);
          }
        }
      }
    }

    // Education
    if (content?.education?.length) {
      addBlank();
      addLine(formatHeading("Education"), true, style.headingSize);
      addSep();
      for (const edu of content.education) {
        addBlank();
        addLine(`${edu.degree}${edu.field_of_study ? ` — ${edu.field_of_study}` : ""}`, true, style.bodySize + 1);
        addLine(edu.institution || "", false, 9);
        const dateParts = [edu.start_date, edu.end_date].filter(Boolean);
        if (dateParts.length) addLine(dateParts.join(" – "), false, 9);
        if (edu.gpa) addLine(`GPA: ${edu.gpa}`, false, 9);
      }
    }

    // Skills
    if (content?.skills?.length) {
      addBlank();
      addLine(formatHeading("Skills"), true, style.headingSize);
      addSep();
      for (const wl of wrapText(content.skills.join(template === "modern" ? "  •  " : ",  "), 90)) addLine(wl);
    }

    // Certifications
    if (content?.certifications?.length) {
      addBlank();
      addLine(formatHeading("Certifications"), true, style.headingSize);
      addSep();
      for (const cert of content.certifications) {
        addLine(`• ${cert.name}${cert.issuing_organization ? ` — ${cert.issuing_organization}` : ""}`);
      }
    }
  }

  return buildPDFBytes(lines, pageWidth, pageHeight, margin, style);
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
  lines: { text: string; bold?: boolean; size?: number; color?: string; isSep?: string; indent?: number }[],
  pageWidth: number,
  pageHeight: number,
  margin: number,
  style: TemplateStyle
): Uint8Array {
  const pages: typeof lines[] = [];
  let currentPage: typeof lines = [];
  let y = pageHeight - margin;

  for (const line of lines) {
    const lh = (line.size || style.bodySize) * 1.4;
    if (y < margin + lh) {
      pages.push(currentPage);
      currentPage = [];
      y = pageHeight - margin;
    }
    currentPage.push(line);
    y -= lh;
  }
  if (currentPage.length) pages.push(currentPage);

  const objects: string[] = [];
  let objCount = 0;
  const addObj = (content: string): number => {
    objCount++;
    objects.push(`${objCount} 0 obj\n${content}\nendobj`);
    return objCount;
  };

  addObj("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesObjIndex = objects.length;
  addObj("");

  // Fonts: F1=body, F2=heading bold, F3=body italic (Times)
  const isTimesBody = style.bodyFont === "Times-Roman";
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /${style.bodyFont} /Encoding /WinAnsiEncoding >>`);
  addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /${style.headingFont} /Encoding /WinAnsiEncoding >>`);

  const pageObjIds: number[] = [];

  for (const pageLines of pages) {
    let streamContent = "";
    let cy = pageHeight - margin;

    for (const line of pageLines) {
      const lh = (line.size || style.bodySize) * 1.4;

      if (line.isSep) {
        if (line.isSep === "line") {
          streamContent += `${style.headingColor} RG\n0.5 w\n${margin} ${cy - 2} m ${pageWidth - margin} ${cy - 2} l S\n`;
          cy -= 6;
        } else if (line.isSep === "double-line") {
          streamContent += `${style.headingColor} RG\n0.8 w\n${margin} ${cy - 1} m ${pageWidth - margin} ${cy - 1} l S\n`;
          streamContent += `0.3 w\n${margin} ${cy - 5} m ${pageWidth - margin} ${cy - 5} l S\n`;
          cy -= 10;
        } else {
          cy -= 8;
        }
        continue;
      }

      if (!line.text) {
        cy -= lh * 0.4;
        continue;
      }

      const fontSize = line.size || style.bodySize;
      const indent = line.indent || 0;
      const escaped = escapePDF(line.text);
      const fontRef = line.bold ? "/F2" : "/F1";
      const color = line.bold ? `${style.headingColor} rg\n` : "0.2 0.2 0.2 rg\n";

      streamContent += `${color}BT ${fontRef} ${fontSize} Tf ${margin + indent} ${cy} Td (${escaped}) Tj ET\n`;
      cy -= lh;
    }

    const stream = `q\n${streamContent}Q`;
    const streamObjId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageObjId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Contents ${streamObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
    );
    pageObjIds.push(pageObjId);
  }

  const kids = pageObjIds.map(id => `${id} 0 R`).join(" ");
  objects[pagesObjIndex] = `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageObjIds.length} >>\nendobj`;

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
  return new TextEncoder().encode(header + body + xref + trailer);
}

function escapePDF(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// ── DOCX Generation ──

function generateDOCX(
  content: any,
  isCoverLetter: boolean,
  name: string,
  profile: any,
  jobTitle: string,
  company: string,
  template: string
): Uint8Array {
  const style = getStyle(template);
  const paragraphs: string[] = [];

  const docxFont = template === "executive" ? "Times New Roman" : "Calibri";
  const accentHex = style.accentColor;

  const p = (text: string, bold = false, size = 22, color?: string, align?: string) => {
    const colorTag = color ? `<w:color w:val="${color}"/>` : "";
    const rPr = `<w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rFonts w:ascii="${docxFont}" w:hAnsi="${docxFont}"/>${colorTag}</w:rPr>`;
    const pPr = align ? `<w:pPr><w:jc w:val="${align}"/></w:pPr>` : "";
    const escaped = escapeXML(text);
    paragraphs.push(`<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`);
  };

  const hr = () => {
    const borderColor = accentHex;
    const sz = style.sectionSep === "double-line" ? "6" : "4";
    paragraphs.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="${sz}" w:space="1" w:color="${borderColor}"/></w:pBdr></w:pPr></w:p>`);
  };

  const formatHeading = (text: string): string => {
    return style.headingCase === "upper" ? text.toUpperCase() : text;
  };

  const headingSize = style.headingSize * 2; // DOCX uses half-points
  const bodySize = style.bodySize * 2;
  const nameSize = style.nameSize * 2;

  if (isCoverLetter) {
    p(name, true, nameSize);
    if (profile?.email) p(profile.email, false, bodySize - 2);
    if (profile?.phone) p(profile.phone, false, bodySize - 2);
    if (profile?.location) p(profile.location, false, bodySize - 2);
    paragraphs.push("<w:p/>");
    p(`Re: ${jobTitle} at ${company}`, true, bodySize);
    paragraphs.push("<w:p/>");
    const text = typeof content === "string" ? content : content?.content || JSON.stringify(content);
    for (const para of text.split(/\n\n|\n/)) {
      if (para.trim()) p(para.trim(), false, bodySize);
      else paragraphs.push("<w:p/>");
    }
  } else {
    // Name - centered for modern/executive
    const nameAlign = template === "modern" || template === "executive" ? "center" : undefined;
    p(name, true, nameSize, accentHex, nameAlign);

    if (content?.headline) p(content.headline, false, bodySize + 2, undefined, nameAlign);

    const contactParts: string[] = [];
    if (profile?.email) contactParts.push(profile.email);
    if (profile?.phone) contactParts.push(profile.phone);
    if (profile?.location) contactParts.push(profile.location);
    if (profile?.linkedin_url) contactParts.push(profile.linkedin_url);
    const sep = template === "modern" ? "  •  " : "  |  ";
    if (contactParts.length) p(contactParts.join(sep), false, bodySize - 2, undefined, nameAlign);
    hr();

    if (content?.summary) {
      paragraphs.push("<w:p/>");
      p(formatHeading("Professional Summary"), true, headingSize, accentHex);
      if (style.sectionSep !== "space") hr();
      p(content.summary, false, bodySize);
      paragraphs.push("<w:p/>");
    }

    if (content?.experience?.length) {
      p(formatHeading("Experience"), true, headingSize, accentHex);
      if (style.sectionSep !== "space") hr();
      for (const exp of content.experience) {
        p(`${exp.title} — ${exp.company}`, true, bodySize);
        const dateLine = `${exp.start_date || ""} – ${exp.is_current ? "Present" : exp.end_date || ""}`;
        if (exp.location) p(`${exp.location}  |  ${dateLine}`, false, bodySize - 4);
        else p(dateLine, false, bodySize - 4);
        if (exp.highlights?.length) {
          for (const h of exp.highlights) {
            p(`• ${h}`, false, bodySize - 2);
          }
        }
        paragraphs.push("<w:p/>");
      }
    }

    if (content?.education?.length) {
      p(formatHeading("Education"), true, headingSize, accentHex);
      if (style.sectionSep !== "space") hr();
      for (const edu of content.education) {
        p(`${edu.degree}${edu.field_of_study ? ` — ${edu.field_of_study}` : ""}`, true, bodySize);
        p(edu.institution || "", false, bodySize - 2);
        const dateParts = [edu.start_date, edu.end_date].filter(Boolean);
        if (dateParts.length) p(dateParts.join(" – "), false, bodySize - 4);
        if (edu.gpa) p(`GPA: ${edu.gpa}`, false, bodySize - 4);
        paragraphs.push("<w:p/>");
      }
    }

    if (content?.skills?.length) {
      p(formatHeading("Skills"), true, headingSize, accentHex);
      if (style.sectionSep !== "space") hr();
      const skillSep = template === "modern" ? "  •  " : ",  ";
      p(content.skills.join(skillSep), false, bodySize);
      paragraphs.push("<w:p/>");
    }

    if (content?.certifications?.length) {
      p(formatHeading("Certifications"), true, headingSize, accentHex);
      if (style.sectionSep !== "space") hr();
      for (const cert of content.certifications) {
        p(`• ${cert.name}${cert.issuing_organization ? ` — ${cert.issuing_organization}` : ""}`, false, bodySize - 2);
      }
    }
  }

  return buildDOCXBytes(paragraphs);
}

function buildDOCXBytes(paragraphs: string[]): Uint8Array {
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
    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 0, true);
    hv.setUint16(8, 0, true);
    hv.setUint16(10, 0, true);
    hv.setUint16(12, 0, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, file.data.length, true);
    hv.setUint32(22, file.data.length, true);
    hv.setUint16(26, nameBytes.length, true);
    hv.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    entries.push({ name: nameBytes, data: file.data, offset });
    chunks.push(header, file.data);
    offset += header.length + file.data.length;
  }

  const centralStart = offset;
  for (const entry of entries) {
    const cd = new Uint8Array(46 + entry.name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    const crc = crc32(entry.data);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, entry.name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, entry.offset, true);
    cd.set(entry.name, 46);
    chunks.push(cd);
    offset += cd.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, offset - centralStart, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);
  chunks.push(eocd);

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
