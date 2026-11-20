// Mesh Trading Journal - Cloud Configuration
// Copy this file to config.js and fill in your actual keys.
window.APP_CONFIG = {
  // Supabase Cloud Project Configuration
  SUPABASE_URL: localStorage.getItem('ADIL_SUPABASE_URL') || "YOUR_SUPABASE_URL_HERE",
  SUPABASE_ANON_KEY: localStorage.getItem('ADIL_SUPABASE_ANON_KEY') || "YOUR_SUPABASE_ANON_KEY_HERE",

  // Hugging Face Multi-Token Pool (for ZeroGPU access)
  HF_SPACE_ID: "YOUR_HF_SPACE_ID",
  HF_ENDPOINT: "YOUR_HF_ENDPOINT",
  HF_TOKENS_POOL: [
    "YOUR_HF_TOKEN_1",
    "YOUR_HF_TOKEN_2"
  ]
};