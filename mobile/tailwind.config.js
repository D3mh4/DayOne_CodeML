/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        whatsapp_teal: "#075E54",
        whatsapp_green: "#128C7E",
        whatsapp_light_green: "#25D366",
        whatsapp_outgoing: "#DCF8C6",
        whatsapp_incoming: "#FFFFFF",
        whatsapp_bg: "#EFEAE2",
        whatsapp_chat_bar: "#F0F2F5",
        whatsapp_check_blue: "#34B7F1",
        whatsapp_gray_text: "#667781",
        whatsapp_system_bubble: "#EDF2F7",
        whatsapp_dark_text: "#111B21",
      },
    },
  },
  plugins: [],
};

