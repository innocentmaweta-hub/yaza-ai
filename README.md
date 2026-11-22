# Yaza AI

Yaza AI is a standalone multi-provider AI chat website. It is designed to work with OpenAI, Google Gemini, OpenRouter, and Moonshot Kimi through server-side API routes.

## Local development

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and add at least one provider API key.
4. Run `npm run dev` for the Vite frontend.

The chat API is a Vercel serverless function in `api/chat.js`. For local API testing, run with Vercel CLI (`vercel dev`) after installing the Vercel CLI.

## Deploy to Vercel

Import this repository into Vercel, use the Vite framework preset, and add the provider keys as environment variables. Never put provider keys in frontend variables such as `VITE_*`.

## Providers

- OpenAI: `OPENAI_API_KEY`
- Gemini: `GEMINI_API_KEY`
- OpenRouter: `OPENROUTER_API_KEY`
- Kimi: `KIMI_API_KEY`

Supabase authentication and cloud conversation sync are included. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel and in .env.local. Run supabase/schema.sql in the Supabase SQL Editor before enabling accounts. Without Supabase configuration, guest/local mode remains available.

The application also includes file uploads, voice input and read-aloud, web search, image generation, conversation sharing, account-synced preferences, and usage tracking.
