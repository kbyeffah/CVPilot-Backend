import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import multer from "multer";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

dotenv.config();

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
}));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "gemma2-9b-it",
];

async function extractPdfText(buffer) {
  const uint8Array = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n";
  }
  return text;
}

async function callGroq(messages) {
  for (const model of MODELS) {
    try {
      const res = await groq.chat.completions.create({ model, messages });
      return res;
    } catch (err) {
      console.log(`Model failed: ${model}`);
    }
  }
  throw new Error("All models failed");
}

app.get("/", (req, res) => {
  res.send("Career Ops MVP Backend Running");
});

app.post("/evaluate", upload.single("file"), async (req, res) => {
  try {
    const { job } = req.body;
    const file = req.file;

    if (!file || !job) {
      return res.status(400).json({ error: "File and job are required" });
    }

    let cvText = "";

    if (file.mimetype === "application/pdf") {
      cvText = await extractPdfText(file.buffer);
    } else if (
      file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      cvText = result.value;
    } else {
      return res.status(400).json({ error: "Only PDF or DOCX allowed" });
    }

    const evaluationPrompt = `
You are a career expert.

CV:
${cvText}

JOB:
${job}

Return:
- Score (0–10) strictly with keen analysis, give a perfect score if
only it's perfect
- Strengths
- Weaknesses
- Recommendation
`;

    const evalRes = await callGroq([{ role: "user", content: evaluationPrompt }]);
    const evaluation = evalRes.choices[0]?.message?.content || "No response";

    const cvPrompt = `
Rewrite this CV professionally for the job.

CV:
${cvText}

JOB:
${job}
`;

    const cvRes = await callGroq([{ role: "user", content: cvPrompt }]);
    const tailoredCV = cvRes.choices[0]?.message?.content || "No response";

    res.json({ success: true, evaluation, tailoredCV });
  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));