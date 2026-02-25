require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Multer setup for image uploads (in-memory storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/generate-cv', upload.single('profilePicture'), async (req, res) => {
    try {
        const { userData, theme } = req.body;
        const parsedUserData = JSON.parse(userData);

        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

        let themeInstruction = "";
        switch(theme) {
            case 'minimalist':
                themeInstruction = "Use a minimalist design with plenty of white space, simple typography (sans-serif), and subtle accents. Avoid heavy borders or bright colors.";
                break;
            case 'creative':
                themeInstruction = "Use a creative design with a bold color palette, unique layout (e.g., sidebars), and modern decorative elements. Use stylish fonts.";
                break;
            case 'classic':
                themeInstruction = "Use a traditional, conservative design. Serif fonts, standard layouts, and a very formal structure. Suitable for law or finance.";
                break;
            default: // modern
                themeInstruction = "Use a sleek, modern professional design with indigo accents, clean sections, and high readability. Use a mix of weights for typography.";
        }

        let prompt = `You are an expert CV writer. Create a professional, highly structured, and visually stunning CV in a single HTML file with embedded CSS.
        The CV should be based on the following user data: ${JSON.stringify(parsedUserData)}.

        Theme Style: ${themeInstruction}

        Layout & Design Guidelines:
        1. STRUCTURE: Use a clear layout (e.g., a two-column layout for 'Modern' and 'Creative', or a sleek one-column for 'Minimalist' and 'Classic'). Ensure generous white space and perfect alignment.
        2. TYPOGRAPHY: Use a professional font stack (e.g., 'Inter', 'Roboto', or 'Segoe UI'). Use distinct font weights for headings vs body text.
        3. SECTIONS: Include Contact Info, Professional Summary, Work Experience, Education, and Skills. Use clear, underlined or bolded section headers.
        4. SPACING: Ensure consistent padding and margins between all elements. The CV should look organized and easy to scan.

        Requirements:
        1. PRINT-FRIENDLY: Must be optimized for A4 paper. Use @media print to hide any non-essential elements and ensure colors translate well to paper.
        2. CONTENT OPTIMIZATION:
           - REWRITE WORK EXPERIENCE: Transform simple job descriptions into achievement-oriented bullet points using powerful action verbs (e.g., 'Spearheaded', 'Engineered', 'Orchestrated').
           - REWRITE SUMMARY: Craft a compelling, high-level professional 'About Me' that highlights the user's unique value proposition.
           - TONE: Maintain a sophisticated, executive-level tone throughout.
           - SKILLS: Group skills logically if there are many.
        3. OUTPUT: Return ONLY the raw HTML code, starting with <!DOCTYPE html>. Do NOT wrap it in markdown code blocks.
        4. PROFILE PICTURE: If provided, integrate it seamlessly (e.g., as a circular or rounded square image in the header or sidebar).`;

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
                    console.log(`Gemini API busy, retrying... (${retries} attempts left)`);
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
        res.status(500).send('Error generating CV: ' + error.message);
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
