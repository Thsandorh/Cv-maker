# AI Professional CV Maker

This is a modern, professional CV maker powered by Gemini AI.

## Features
- **AI-Powered Content**: Gemini optimizes your job descriptions and summary to sound more professional.
- **Multiple Themes**: Choose between Modern, Minimalist, Creative, and Classic styles.
- **Profile Picture**: Upload your photo and the AI will integrate it into the design.
- **Live Preview**: See your CV as you build it.
- **Print to PDF**: High-quality PDF export using browser print (optimized with CSS).

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Create a `.env` file in the root directory and add your Gemini API Key:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Access the app**:
   Open your browser and go to `http://localhost:3000`.

## Tech Stack
- **Backend**: Node.js, Express, Multer, @google/generative-ai
- **Frontend**: Tailwind CSS, Vanilla JavaScript
- **AI**: Gemini 2.0 Flash (via Google AI SDK)
