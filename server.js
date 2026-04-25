import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import multer from "multer";
import mammoth from "mammoth";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

dotenv.config();

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
}));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "gemma2-9b-it",
];

async function callGroq(messages) {
  for (const model of MODELS) {
    try {
      const res = await groq.chat.completions.create({
        model,
        messages,
      });
      return res;
    } catch (err) {
      console.log(`Model failed: ${model} — ${err.message}`);
    }
  }
  throw new Error("All models failed");
}

app.get("/", (req, res) => {
  res.send("CVPilot Backend Running");
});

app.post("/evaluate", upload.single("file"), async (req, res) => {
  try {
    const { job } = req.body;
    const file = req.file;

    if (!file || !job) {
      return res.status(400).json({
        error: "File and job description are required",
      });
    }

    let cvText = "";

    if (file.mimetype === "application/pdf") {
      const data = await pdfParse(file.buffer);
      cvText = data.text;
    } else if (
      file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      cvText = result.value;
    } else {
      return res.status(400).json({
        error: "Only PDF or DOCX files are allowed",
      });
    }

    if (!cvText || cvText.trim().length === 0) {
      return res.status(422).json({
        error: "Could not extract text from the uploaded file",
      });
    }

    const evaluationPrompt = `
You are a senior career coach and recruitment expert.

Carefully read the CV and the job description below, then provide:

1. Overall Score: X/10 (be honest and precise)
2. Strengths: bullet points of what matches well
3. Weaknesses: bullet points of gaps or missing keywords
4. Recommendation: 2-3 sentences on what to improve

CV:
${cvText}

JOB DESCRIPTION:
${job}
`;

    const evalRes = await callGroq([
      { role: "user", content: evaluationPrompt },
    ]);

    const evaluation = evalRes.choices[0]?.message?.content || "No response";

    const cvPrompt = `
You are a professional CV writer. Rewrite the CV below so it is tailored specifically for the job description provided.

Rules:
- Keep all factual information accurate, do not invent experience
- Use keywords and phrases from the job description naturally
- Use clean markdown formatting with clear sections
- Make it concise, professional, and ATS-friendly

CV:
${cvText}

JOB DESCRIPTION:
${job}
`;

    const cvRes = await callGroq([
      { role: "user", content: cvPrompt },
    ]);

    const tailoredCV = cvRes.choices[0]?.message?.content || "No response";

    res.json({
      success: true,
      evaluation,
      tailoredCV,
    });
  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({
      success: false,
      error: "Server error — check function logs",
    });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`CVPilot backend running on http://localhost:${PORT}`);
});