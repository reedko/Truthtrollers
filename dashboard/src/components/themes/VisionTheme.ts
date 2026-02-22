// src/theme.ts
import { extendTheme } from "@chakra-ui/react";
const API_BASE_URL = import.meta.env.VITE_BASE_URL || "https://localhost:5001";

const theme = extendTheme({
  config: {
    initialColorMode: "dark",
    useSystemColorMode: false,
  },
  fonts: {
    heading: "'DM Sans', sans-serif",
    body: "'DM Sans', sans-serif",
  },
  styles: {
    global: (props: any) => ({
      html: {
      },
      body: {
        bgGradient: props.colorMode === "dark"
          ? "radial-gradient(circle at 75% 80%, rgba(94, 234, 212, 0.4), rgba(2, 0, 36, 0.95))"
          : "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.6) 0%, rgba(148, 163, 184, 0.4) 30%, rgba(226, 232, 240, 0.3) 70%)",
        backgroundAttachment: "fixed",
        backgroundPosition: "center",
        color: props.colorMode === "dark" ? "gray.100" : "gray.700",
        margin: 0,
        padding: 0,
        boxSizing: "border-box",
      },
      "#root": {
      },
    }),
  },
  textures: {
    backgroundImage: `${API_BASE_URL}/assets/images/textures/glucose.png`, // ensure it's in your public folder
  },
  colors: {
    brand: {
      100: "#CFFAFE",
      500: "#06b6d4",
      900: "#0e7490",
    },
  },
  semanticTokens: {
    colors: {
      cardGradient: {
        _light: "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.15), rgba(148, 163, 184, 0.25))",
        _dark: "radial-gradient(circle at 70% 70%, rgba(72, 187, 215, 0.25), rgba(45, 55, 72, 1))",
      },
      stackGradient: {
        _light: "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.12), rgba(148, 163, 184, 0.2))",
        _dark: "radial-gradient(circle at 75% 80%, rgba(136, 230, 196, 0.31), rgb(2, 0, 36))",
      },
      statGradient: {
        _light: "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.25) 0%, rgba(148, 163, 184, 0.2) 50%, rgba(226, 232, 240, 0.15) 100%)",
        _dark: "radial-gradient(circle at bottom left, rgba(0, 255, 225, 0.05) 0%, #0a192f 20%, #010212 50%, #000000 80%)",
      },
      stat2Gradient: {
        _light: "linear-gradient(to top right, rgba(71, 85, 105, 0.2), rgba(148, 163, 184, 0.15))",
        _dark: "linear-gradient(to top right, rgba(0, 100, 90, 1), rgba(0, 0, 0, 1))",
      },
      cardTeal: {
        _light: "teal.500",
        _dark: "teal.400",
      },
      cardBlue: {
        _light: "#06b6d4",
        _dark: "#4682b4",
      },
      cardGreen: {
        _light: "#10b981",
        _dark: "#175d48",
      },
      cardBlue2: {
        _light: "#06b6d4",
        _dark: "#212e4d",
      },
    },
  },
  components: {
    Card: {
      baseStyle: (props: any) => ({
        container: {
          bgGradient: props.colorMode === "dark"
            ? "radial-gradient(circle at 70% 70%, rgba(72, 187, 215, 0.25), rgba(45, 55, 72, 1))"
            : "radial-gradient(circle at bottom left, rgba(71, 85, 105, 0.15), rgba(148, 163, 184, 0.2))",
          borderRadius: "2xl",
          boxShadow: props.colorMode === "dark" ? "lg" : "0 2px 8px rgba(71, 85, 105, 0.15)",
          border: "1px solid",
          borderColor: props.colorMode === "dark" ? "gray.700" : "rgba(100, 116, 139, 0.25)",
          backdropFilter: "blur(12px)",
        },
      }),
    },
    Heading: {
      baseStyle: (props: any) => ({
        fontWeight: "bold",
        color: props.colorMode === "dark" ? "teal.300" : "teal.600",
      }),
    },
  },
});

export default theme;
