require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

        let prompt = `You are an expert CV writer. Create a professional and visually appealing CV in a single HTML file with embedded CSS.
        The CV should be based on the following user data: ${JSON.stringify(parsedUserData)}.

        Theme Style: ${themeInstruction}

        Requirements:
        1. Include sections for: Contact Info, Profile/Summary, Experience, Education, and Skills.
        2. Make it print-friendly (use @media print to ensure it looks perfect on A4 paper).
        3. Professional Optimization:
           - Transform simple job descriptions into achievement-oriented bullet points using action verbs (e.g., 'Managed', 'Developed', 'Optimized').
           - Refine the 'Summary' to be a compelling elevator pitch.
           - Ensure the tone is professional, confident, and sophisticated.
           - Suggest appropriate professional skills if the user provided only a few.
        4. Return ONLY the HTML code, starting with <!DOCTYPE html>. No markdown formatting around the code.
        5. If a profile picture is provided, include it elegantly in the design.`;

        const parts = [{ text: prompt }];

        let dataUri = "";
        if (req.file) {
            const base64Data = req.file.buffer.toString("base64");
            dataUri = `data:${req.file.mimetype};base64,${base64Data}`;

            parts.push({
                inlineData: {
                    data: base64Data,
                    mimeType: req.file.mimetype
                }
            });
            prompt += `\n\nCRITICAL: A profile picture is provided. You MUST include an <img> tag for it. The src attribute of this <img> tag MUST be EXACTLY the text "{{PROFILE_PICTURE_DATA_URI}}" (including the curly braces). Do not use any other placeholder URL.`;
        }

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
            html = html.replace(/\{\{PROFILE_PICTURE_DATA_URI\}\}/g, dataUri);
            // Fallback: Replace common placeholders that Gemini might use instead of the requested placeholder
            html = html.replace(/https:\/\/via\.placeholder\.com\/[0-9x]+/g, dataUri);
            html = html.replace(/https:\/\/placehold\.co\/[0-9x]+/g, dataUri);
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
