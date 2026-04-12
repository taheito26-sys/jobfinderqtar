import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "Content-Disposition, content-disposition",
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
    const { document_id, format = "pdf", parsed_content, template = "classic", document_type, job_title: reqJobTitle, company: reqCompany } = body;

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
    const jobTitle = reqJobTitle || (doc as any).jobs?.title || "Position";
    const company = reqCompany || (doc as any).jobs?.company || "Company";

    const formatDate = (d: string | null | undefined): string => {
      if (!d) return "";
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

    // Build filename as Company_JobTitle_CV.ext or Company_JobTitle_CoverLetter.ext
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_").substring(0, 50);
    const docTypeSuffix = isCoverLetter ? "CoverLetter" : "CV";
    const filePrefix = `${sanitize(company)}_${sanitize(jobTitle)}_${docTypeSuffix}`;

    let fileBuffer: Uint8Array;
    let mimeType: string;
    let fileName: string;

    if (format === "pdf") {
      fileBuffer = generatePDF(content, isCoverLetter, candidateName, profile, jobTitle, company, template);
      mimeType = "application/pdf";
      fileName = `${filePrefix}.pdf`;
    } else {
      fileBuffer = generateDOCX(content, isCoverLetter, candidateName, profile, jobTitle, company, template);
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      fileName = `${filePrefix}.docx`;
    }

    return new Response(fileBuffer as unknown as BodyInit, {
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

// ── Approximate glyph widths for Helvetica (per 1000 units) ──
const HELVETICA_WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015, "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778,
  "H": 722, "I": 278, "J": 500, "K": 667, "L": 556, "M": 833, "N": 722, "O": 778,
  "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722, "V": 667, "W": 944,
  "X": 667, "Y": 667, "Z": 611, "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556,
  "`": 333, "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556,
  "h": 556, "i": 222, "j": 222, "k": 500, "l": 222, "m": 833, "n": 556, "o": 556,
  "p": 556, "q": 556, "r": 333, "s": 500, "t": 278, "u": 556, "v": 500, "w": 722,
  "x": 500, "y": 500, "z": 500, "{": 334, "|": 260, "}": 334, "~": 584,
  "\u2022": 350, "\u2013": 556, "\u2014": 1000,
};

// Bold widths are slightly wider
const HELVETICA_BOLD_WIDTHS: Record<string, number> = {
  ...HELVETICA_WIDTHS,
  "A": 722, "B": 722, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778,
  "H": 722, "I": 278, "J": 556, "K": 722, "L": 611, "M": 833, "N": 722,
  "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722,
  "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611,
  "a": 556, "b": 611, "c": 556, "d": 611, "e": 556, "f": 333, "g": 611,
  "h": 611, "i": 278, "j": 278, "k": 556, "l": 278, "m": 889, "n": 611,
  "o": 611, "p": 611, "q": 611, "r": 389, "s": 556, "t": 333, "u": 611,
  "v": 556, "w": 778, "x": 556, "y": 556, "z": 500,
  " ": 278,
};

function measureText(text: string, fontSize: number, bold: boolean): number {
  const widths = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let w = 0;
  for (const ch of text) {
    w += (widths[ch] || 556);
  }
  return (w * fontSize) / 1000;
}

function wrapTextByWidth(text: string, fontSize: number, bold: boolean, maxWidth: number): string[] {
  if (!text) return [""];
  const words = text.split(" ");
  const result: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const test = currentLine ? currentLine + " " + word : word;
    if (measureText(test, fontSize, bold) > maxWidth && currentLine) {
      result.push(currentLine);
      currentLine = word;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) result.push(currentLine);
  return result.length ? result : [""];
}

// ── Template styles ──
interface TemplateStyle {
  headingColor: string;
  accentColor: string;
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
    headingColor: "0.2 0.2 0.2",
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
    nameSize: 28,
    headingSize: 13,
    bodySize: 10,
    sectionSep: "double-line",
    headingCase: "upper",
  },
  executive: {
    headingColor: "0.25 0.14 0.08",
    accentColor: "3F2412",
    bodyFont: "Helvetica",
    headingFont: "Helvetica-Bold",
    nameSize: 28,
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

// ── Extract cover letter text ──
function extractLetterText(content: any): string {
  let letterText = "";
  if (typeof content === "string") {
    letterText = content;
  } else if (content?.letter_text) {
    letterText = typeof content.letter_text === "string" ? content.letter_text : "";
  } else if (content?.content && typeof content.content === "string") {
    letterText = content.content;
  } else if (content?.content?.letter_text) {
    letterText = content.content.letter_text;
  } else {
    for (const key of Object.keys(content || {})) {
      const val = content[key];
      if (typeof val === "string" && val.length > 100 && val.includes("Dear")) {
        letterText = val;
        break;
      }
    }
    if (!letterText) letterText = content?.summary || "";
  }
  return letterText.replace(/\\n/g, "\n");
}

// ── PDF Generation ──

interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
  color?: string;
  isSep?: string;
  indent?: number;
}

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
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;
  const lines: PdfLine[] = [];

  const addLine = (text: string, bold = false, size?: number, indent = 0) => {
    const fontSize = size || style.bodySize;
    // Wrap text properly by measuring font width
    if (text && !bold && fontSize <= style.bodySize + 2) {
      const wrapped = wrapTextByWidth(text, fontSize, bold, contentWidth - indent);
      for (const wl of wrapped) {
        lines.push({ text: wl, bold, size: fontSize, indent });
      }
    } else {
      lines.push({ text, bold, size: fontSize, indent });
    }
  };
  const addSep = () => lines.push({ text: "", isSep: style.sectionSep, size: 0 });
  const addBlank = () => lines.push({ text: "", size: style.bodySize * 0.6 });
  const formatHeading = (text: string): string =>
    style.headingCase === "upper" ? text.toUpperCase() : text;

  if (isCoverLetter) {
    // Name
    lines.push({ text: name, bold: true, size: style.nameSize });
    // Contact
    const parts: string[] = [];
    if (profile?.location) parts.push(profile.location);
    if (profile?.phone) parts.push(profile.phone);
    if (profile?.email) parts.push(profile.email);
    if (parts.length) lines.push({ text: parts.join("  \u2022  "), size: 9 });
    addSep();
    addBlank();

    // Date
    const today = new Date();
    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    addLine(`${monthNames[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`);
    addBlank();

    // Subject
    lines.push({ text: `Re: ${jobTitle} at ${company}`, bold: true, size: style.headingSize });
    addBlank();

    // Letter body
    const letterText = extractLetterText(content);
    const paragraphs = letterText.split(/\n\n+/);
    for (const para of paragraphs) {
      const cleaned = para.replace(/\n/g, " ").trim();
      if (cleaned) {
        addLine(cleaned);
        addBlank();
      }
    }
  } else {
    // CV
    lines.push({ text: name, bold: true, size: style.nameSize });
    if (content?.headline) lines.push({ text: content.headline, size: style.bodySize + 2 });
    const contactParts: string[] = [];
    if (profile?.location) contactParts.push(profile.location);
    if (profile?.phone) contactParts.push(profile.phone);
    if (profile?.email) contactParts.push(profile.email);
    if (profile?.linkedin_url) contactParts.push(profile.linkedin_url);
    if (contactParts.length) lines.push({ text: contactParts.join("  |  "), size: 9 });
    addSep();

    if (content?.summary) {
      addBlank();
      lines.push({ text: formatHeading("Professional Summary"), bold: true, size: style.headingSize });
      addSep();
      addLine(content.summary);
    }

    if (content?.experience?.length) {
      addBlank();
      lines.push({ text: formatHeading("Experience"), bold: true, size: style.headingSize });
      addSep();
      for (const exp of content.experience) {
        addBlank();
        lines.push({ text: `${exp.title} — ${exp.company}`, bold: true, size: style.bodySize + 1 });
        const dateLine = `${exp.start_date || ""} – ${exp.is_current ? "Present" : exp.end_date || ""}`;
        if (exp.location) lines.push({ text: `${exp.location}  |  ${dateLine}`, size: 9 });
        else lines.push({ text: dateLine, size: 9 });
        if (exp.description) addLine(exp.description, false, style.bodySize, 10);
        if (exp.highlights?.length) {
          for (const h of exp.highlights) {
            addLine(`\u2022 ${h}`, false, style.bodySize, 10);
          }
        }
      }
    }

    if (content?.education?.length) {
      addBlank();
      lines.push({ text: formatHeading("Education"), bold: true, size: style.headingSize });
      addSep();
      for (const edu of content.education) {
        addBlank();
        lines.push({ text: `${edu.degree}${edu.field_of_study ? ` — ${edu.field_of_study}` : ""}`, bold: true, size: style.bodySize + 1 });
        lines.push({ text: edu.institution || "", size: 9 });
        const dp = [edu.start_date, edu.end_date].filter(Boolean);
        if (dp.length) lines.push({ text: dp.join(" – "), size: 9 });
      }
    }

    if (content?.skills?.length) {
      addBlank();
      lines.push({ text: formatHeading("Skills"), bold: true, size: style.headingSize });
      addSep();
      addLine(content.skills.join(",  "));
    }

    if (content?.certifications?.length) {
      addBlank();
      lines.push({ text: formatHeading("Certifications"), bold: true, size: style.headingSize });
      addSep();
      for (const cert of content.certifications) {
        addLine(`\u2022 ${cert.name}${cert.issuing_organization ? ` — ${cert.issuing_organization}` : ""}`);
      }
    }
  }

  return buildPDFBytes(lines, pageWidth, pageHeight, margin, style);
}

function buildPDFBytes(
  lines: PdfLine[],
  pageWidth: number,
  pageHeight: number,
  margin: number,
  style: TemplateStyle
): Uint8Array {
  // Paginate
  const pages: PdfLine[][] = [];
  let currentPage: PdfLine[] = [];
  let y = pageHeight - margin;

  for (const line of lines) {
    const lh = (line.size || style.bodySize) * 1.4;
    if (line.isSep) {
      if (y < margin + 20) {
        pages.push(currentPage);
        currentPage = [];
        y = pageHeight - margin;
      }
      currentPage.push(line);
      y -= (line.isSep === "double-line" ? 10 : 6);
      continue;
    }
    if (!line.text) {
      y -= lh * 0.5;
      currentPage.push(line);
      continue;
    }
    if (y - lh < margin) {
      pages.push(currentPage);
      currentPage = [];
      y = pageHeight - margin;
    }
    currentPage.push(line);
    y -= lh;
  }
  if (currentPage.length) pages.push(currentPage);

  // Build PDF objects
  const objects: string[] = [];
  let objCount = 0;
  const addObj = (content: string): number => {
    objCount++;
    objects.push(`${objCount} 0 obj\n${content}\nendobj`);
    return objCount;
  };

  addObj("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesObjIndex = 1; // index in objects array
  addObj(""); // placeholder for Pages obj

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
        cy -= lh * 0.5;
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
  let bodyStr = "";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(header.length + bodyStr.length);
    bodyStr += obj + "\n";
  }
  const xrefOffset = header.length + bodyStr.length;
  let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(header + bodyStr + xref + trailer);
}

function escapePDF(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    // Convert bullet to a simple dash for PDF Type1 font compatibility
    .replace(/\u2022/g, "-");
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
  const docxFont = "Calibri";
  const accentHex = style.accentColor;

  const headingSize = style.headingSize * 2;
  const bodySize = style.bodySize * 2;
  const nameSize = style.nameSize * 2;

  const p = (text: string, bold = false, size = bodySize, color?: string, align?: string) => {
    const colorTag = color ? `<w:color w:val="${color}"/>` : "";
    const rPr = `<w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rFonts w:ascii="${docxFont}" w:hAnsi="${docxFont}"/>${colorTag}</w:rPr>`;
    const pPr = align ? `<w:pPr><w:jc w:val="${align}"/></w:pPr>` : "";
    const escaped = escapeXML(text);
    paragraphs.push(`<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`);
  };

  const hr = () => {
    paragraphs.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="${accentHex}"/></w:pBdr></w:pPr></w:p>`);
  };

  const formatHeading = (text: string): string =>
    style.headingCase === "upper" ? text.toUpperCase() : text;

  const blank = () => paragraphs.push("<w:p/>");

  if (isCoverLetter) {
    // Name
    p(name, true, nameSize, accentHex);
    // Contact
    const parts: string[] = [];
    if (profile?.location) parts.push(profile.location);
    if (profile?.phone) parts.push(profile.phone);
    if (profile?.email) parts.push(profile.email);
    if (parts.length) p(parts.join("  |  "), false, 18);
    hr();
    blank();

    // Date
    const today = new Date();
    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    p(`${monthNames[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`, false, bodySize);
    blank();

    // Subject
    p(`Re: ${jobTitle} at ${company}`, true, headingSize, accentHex);
    blank();

    // Letter body
    const letterText = extractLetterText(content);
    const letterParas = letterText.split(/\n\n+/);
    for (const lp of letterParas) {
      const cleaned = lp.replace(/\n/g, " ").trim();
      if (cleaned) p(cleaned, false, bodySize);
      else blank();
    }

    // Sign-off: separate "Sincerely," and name
    blank();
    p("Sincerely,", false, bodySize);
    p(name, true, bodySize);
  } else {
    // CV
    p(name, true, nameSize, accentHex);
    if (content?.headline) p(content.headline, false, bodySize + 2);
    const contactParts: string[] = [];
    if (profile?.location) contactParts.push(profile.location);
    if (profile?.phone) contactParts.push(profile.phone);
    if (profile?.email) contactParts.push(profile.email);
    if (profile?.linkedin_url) contactParts.push(profile.linkedin_url);
    if (contactParts.length) p(contactParts.join("  |  "), false, 18);
    hr();

    if (content?.summary) {
      blank();
      p(formatHeading("Professional Summary"), true, headingSize, accentHex);
      if (style.sectionSep !== "space") hr();
      p(content.summary, false, bodySize);
      blank();
    }

    if (content?.experience?.length) {
      p(formatHeading("Experience"), true, headingSize, accentHex);
      if (style.sectionSep !== "space") hr();
      for (const exp of content.experience) {
        p(`${exp.title} — ${exp.company}`, true, bodySize);
        const dateLine = `${exp.start_date || ""} – ${exp.is_current ? "Present" : exp.end_date || ""}`;
        if (exp.location) p(`${exp.location}  |  ${dateLine}`, false, bodySize - 4);
        else p(dateLine, false, bodySize - 4);
        if (exp.description) p(exp.description, false, bodySize - 2);
        if (exp.highlights?.length) {
          for (const h of exp.highlights) {
            p(`• ${h}`, false, bodySize - 2);
          }
        }
        blank();
      }
    }

    if (content?.education?.length) {
      p(formatHeading("Education"), true, headingSize, accentHex);
      if (style.sectionSep !== "space") hr();
      for (const edu of content.education) {
        p(`${edu.degree}${edu.field_of_study ? ` — ${edu.field_of_study}` : ""}`, true, bodySize);
        p(edu.institution || "", false, bodySize - 2);
        const dp = [edu.start_date, edu.end_date].filter(Boolean);
        if (dp.length) p(dp.join(" – "), false, bodySize - 4);
        blank();
      }
    }

    if (content?.skills?.length) {
      p(formatHeading("Skills"), true, headingSize, accentHex);
      if (style.sectionSep !== "space") hr();
      p(content.skills.join(",  "), false, bodySize);
      blank();
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
    hv.setUint16(8, 0, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, file.data.length, true);
    hv.setUint32(22, file.data.length, true);
    hv.setUint16(26, nameBytes.length, true);
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
    const crc = crc32(entry.data);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, entry.name.length, true);
    cv.setUint32(42, entry.offset, true);
    cd.set(entry.name, 46);
    chunks.push(cd);
    offset += cd.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, offset - centralStart, true);
  ev.setUint32(16, centralStart, true);
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
