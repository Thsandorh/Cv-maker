require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve static files with explicit MIME types
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Error handler for Multer
app.use((err, req, res, next) => {
    if (err.name === 'MulterError') {
        return res.status(400).send('Upload Error: ' + err.message);
    }
    next(err);
});

// Multer setup for image uploads (in-memory storage)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 4 * 1024 * 1024 } // 4MB limit for Vercel payloads
});

const { GoogleGenerativeAI } = require("@google/generative-ai");

app.post('/api/generate-cv', upload.single('profilePicture'), async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY is not configured in environment variables.");
        }
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        if (!req.body || !req.body.userData) {
            return res.status(400).send('Error: Missing userData in request body.');
        }

        const { userData, theme } = req.body;
        let parsedUserData;
        try {
            parsedUserData = JSON.parse(userData);
        } catch (e) {
            return res.status(400).send('Error: Invalid JSON in userData.');
        }

        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        let themeInstruction = "";
        switch(theme) {
            case 'minimalist':
                themeInstruction = `DESIGN SYSTEM: 'Minimalist'
                - Visual Style: 'Swiss Design' aesthetic. Ultra-clean, high whitespace, no clutter.
                - Typography: Sans-serif (Inter, Roboto, or Helvetica). Light to Regular weights.
                - Layout: Single column or simple 30/70 split.
                - Color Palette: Monochrome (Black text, White background, Light Grey borders).
                - Mood: Sophisticated, efficient, clarity-focused.`;
                break;
            case 'creative':
                themeInstruction = `DESIGN SYSTEM: 'Creative'
                - Visual Style: 'Modern Editorial'. Bold, expressive, and unique.
                - Typography: Mix of Serif (Playfair Display) for headers and Sans-serif (Lato) for body.
                - Layout: Asymmetric or Grid-based. Use of colored blocks or subtle background shapes.
                - Color Palette: High contrast. Use #5E17EB (Electric Blue) or #FFDE59 (Yellow) as accents against dark text.
                - Mood: Innovative, bold, personality-driven.`;
                break;
            case 'classic':
                themeInstruction = `DESIGN SYSTEM: 'Classic'
                - Visual Style: 'Ivy League / Corporate'. Traditional and authoritative.
                - Typography: Serif (Merriweather, Garamond, or Times New Roman).
                - Layout: Single column, centered headers, horizontal dividers.
                - Color Palette: Navy Blue, Charcoal Grey, or Black text. White background.
                - Mood: Reliable, experienced, executive.`;
                break;
            default: // modern
                themeInstruction = `DESIGN SYSTEM: 'Modern'
                - Visual Style: 'Tech / Startup'. Clean, grid-based, flat design.
                - Typography: Sans-serif (Open Sans, Montserrat). Bold headers.
                - Layout: Two-column (Sidebar for contact/skills, Main for exp).
                - Color Palette: Slate Grey, nice Blue accents, dark text.
                - Mood: Professional, current, adaptable.`;
        }

        let inputProcessingInstruction = "";
        if (parsedUserData.mode === 'bulk') {
            inputProcessingInstruction = `INPUT DATA (UNSTRUCTURED):
            The user provided raw text. You must function as an NLP extractor:
            1. Parse the text below to identify Contact Info, Experience, Education, and Skills.
            2. Infer missing structure (e.g., if a date is "2020-2022", identify it as duration).
            3. IGNORE irrelevant conversational text.
            RAW DATA:
            ${parsedUserData.bulkData}

            KNOWN PERSONAL DETAILS: ${JSON.stringify({
                fullName: parsedUserData.fullName,
                email: parsedUserData.email,
                phone: parsedUserData.phone,
                location: parsedUserData.location
            })}`;
        } else {
            inputProcessingInstruction = `INPUT DATA (STRUCTURED):
            Use the JSON data provided below. Map fields directly to CV sections.
            DATA: ${JSON.stringify(parsedUserData)}`;
        }

        let prompt = `ROLE: You are an elite Career Strategist and Expert Frontend Architect. Your goal is to create a high-impact, ATS-optimized HTML CV that gets the user hired.

        TASK: Generate a single, self-contained HTML5 file for a CV based on the User Data and Design System provided.

        ${inputProcessingInstruction}

        ${themeInstruction}

        CRITICAL REQUIREMENTS (35-POINT QUALITY CHECK):
        1. LANGUAGE: Output MUST be in HUNGARIAN (Magyar). Translate Section Headers:
           - "Experience" -> "Szakmai Tapasztalat"
           - "Education" -> "Tanulmányok"
           - "Skills" -> "Készségek"
           - "Contact" -> "Kapcsolat"
           - "About Me" -> "Rólam" or "Bemutatkozás"

        2. CONTENT REFINEMENT (The "STAR" Method):
           - Do NOT just copy the input descriptions.
           - REWRITE work experiences to be achievement-oriented.
           - Use the formula: "Action Verb + Task + Result" (e.g., "Növelte az eladásokat 20%-kal...").
           - Use professional Hungarian action verbs (e.g., "Koordinálta", "Fejlesztette", "Vezette").
           - If the input is sparse, expand it professionally without hallucinating specific lies.

        3. DESIGN & TECH SPECS:
           - OUTPUT: Raw HTML only. Start with <!DOCTYPE html>. NO Markdown.
           - STYLING: Use embedded CSS (<style>). You may use a CDN for Tailwind CSS (<script src="https://cdn.tailwindcss.com"></script>) to make styling easier and modern.
           - LAYOUT: Must be responsive but optimized for A4 PRINT.
           - FONTS: Use Google Fonts via CDN (import them in <head>). Match the Design System.
           - ICONS: Use FontAwesome or SVG icons for Contact info (Phone, Email, Location).

        4. SINGLE PAGE CONSTRAINT:
           - THIS IS CRITICAL: The CV MUST fit on EXACTLY ONE (1) A4 PAGE, no overflow, no second page.
           - Hard rule: If content would exceed one page, you MUST aggressively compress layout/content density while preserving readability and professional quality.
           - Mandatory tactics (use as needed):
             * Prefer compact 2-column layout.
             * Reduce font sizes safely (body down to 9pt if needed, headings proportionally).
             * Tighten line-height, margins, paddings, and section gaps.
             * Shorten bullet points to concise, high-impact statements.
             * Prioritize strongest/relevant items and omit low-value verbosity.
           - You MUST avoid any design that spills to page 2.
           - CSS requirement for output: @media print { @page { size: A4; margin: 0; } html, body { width: 210mm; height: 297mm; margin: 0; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
           - Screen requirement: keep the same A4 aspect ratio baseline (210mm x 297mm) so preview and print match.

        5. PROFILE PICTURE LOGIC:
           - If a profile picture is provided, place it according to the design theme (e.g., circle in sidebar).
           - IMG SRC: You MUST use exactly: src="{{PROFILE_PICTURE_DATA_URI}}"
           - STYLE: object-fit: cover; border-radius: 50% (or theme appropriate); aspect-ratio: 1/1.

        6. ANTI-HALLUCINATION:
           - Do not invent degrees or companies.
           - Do not add "Lorem Ipsum".
           - If a section (like Education) is empty in the input, OMIT that section entirely.

        GENERATE THE HTML NOW.`;

        let dataUri = "";
        const parts = [];

        if (req.file) {
            const base64Data = req.file.buffer.toString("base64");
            dataUri = `data:${req.file.mimetype};base64,${base64Data}`;

            parts.push({
                inlineData: {
                    data: base64Data,
                    mimeType: req.file.mimetype
                }
            });
            prompt += `\n\nCRITICAL: A profile picture is provided. You MUST include an <img> tag for it. The src attribute of this <img> tag MUST be EXACTLY the text "{{PROFILE_PICTURE_DATA_URI}}" (including the curly braces). Do not use any other placeholder URL. Ensure the image has appropriate styling (e.g., width, height, object-fit, border-radius).`;
        }

        parts.unshift({ text: prompt });

        let result;
        let retries = 3;
        while (retries > 0) {
            try {
                result = await model.generateContent(parts);
                break;
            } catch (err) {
                if (err.status === 503 || err.status === 429) {
                    retries--;
                    if (retries === 0) throw err;
                    console.log(`AI Service busy, retrying... (${retries} attempts left)`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    throw err;
                }
            }
        }

        const response = await result.response;
        let html = response.text();

        // Clean up markdown code blocks if Gemini returns them
        html = html.replace(/```html/g, "").replace(/```/g, "").trim();

        // Replace placeholder with actual data URI if present
        if (dataUri) {
            // Standard placeholder
            html = html.replace(/\{\{PROFILE_PICTURE_DATA_URI\}\}/g, dataUri);

            // Fallback: Replace common placeholders that Gemini might use instead of the requested placeholder
            html = html.replace(/https?:\/\/via\.placeholder\.com\/[^\s"'>]+/g, dataUri);
            html = html.replace(/https?:\/\/placehold\.co\/[^\s"'>]+/g, dataUri);
            html = html.replace(/https?:\/\/picsum\.photos\/[^\s"'>]+/g, dataUri);

            // Even broader fallback: if we still see a likely profile image tag with a dummy src
            // but didn't find the specific placeholder, let's try to find any img tag and if there's only one, replace its src.
            // Or better: look for tags like src="profile.jpg", src="avatar.png", etc.
            html = html.replace(/src="[^"]*(?:profile|avatar|user|portrait)[^"]*"/gi, `src="${dataUri}"`);
        }

        res.send(html);
    } catch (error) {
        console.error('Error generating CV:', error);
        const status = error.name === 'MulterError' ? 400 : 500;
        res.status(status).send('Error generating CV: ' + error.message);
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export for Vercel
module.exports = app;

// Only listen if not running as a module (local dev)
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}
