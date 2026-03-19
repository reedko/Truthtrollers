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
        background: props.colorMode === "dark"
          ? "radial-gradient(circle at 75% 80%, rgba(94, 234, 212, 0.4), rgba(2, 0, 36, 0.95))"
          : "linear-gradient(to bottom, #cbd5e1 0%, #e2e8f0 30%, #f1f5f9 60%, #e2e8f0 100%)",
        backgroundAttachment: "fixed",
        backgroundPosition: "center",
        color: props.colorMode === "dark" ? "gray.100" : "gray.900",
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
        _light: "linear-gradient(135deg, rgba(71, 85, 105, 0.08) 0%, rgba(100, 116, 139, 0.05) 100%)",
        _dark: "radial-gradient(circle at 70% 70%, rgba(72, 187, 215, 0.25), rgba(45, 55, 72, 1))",
      },
      stackGradient: {
        _light: "linear-gradient(135deg, rgba(71, 85, 105, 0.06) 0%, rgba(100, 116, 139, 0.04) 100%)",
        _dark: "radial-gradient(circle at 75% 80%, rgba(136, 230, 196, 0.31), rgb(2, 0, 36))",
      },
      statGradient: {
        _light: "linear-gradient(135deg, rgba(71, 85, 105, 0.1) 0%, rgba(100, 116, 139, 0.08) 50%, rgba(148, 163, 184, 0.05) 100%)",
        _dark: "radial-gradient(circle at bottom left, rgba(0, 255, 225, 0.05) 0%, #0a192f 20%, #010212 50%, #000000 80%)",
      },
      stat2Gradient: {
        _light: "linear-gradient(135deg, rgba(71, 85, 105, 0.12), rgba(100, 116, 139, 0.08))",
        _dark: "linear-gradient(to top right, rgba(0, 100, 90, 1), rgba(0, 0, 0, 1))",
      },
      cardTeal: {
        _light: "teal.700",
        _dark: "teal.400",
      },
      cardBlue: {
        _light: "#0e7490",
        _dark: "#4682b4",
      },
      cardGreen: {
        _light: "#047857",
        _dark: "#175d48",
      },
      cardBlue2: {
        _light: "#0e7490",
        _dark: "#212e4d",
      },
    },
  },
  components: {
    Modal: {
      baseStyle: (props: any) => ({
        overlay: {
          bg: "rgba(0, 0, 0, 0.6)",
        },
        dialog: {
          bg: props.colorMode === "dark"
            ? "rgba(15, 23, 42, 0.95)"
            : "rgba(255, 255, 255, 0.95)",
          borderRadius: "2xl",
          border: "2px solid",
          borderColor: props.colorMode === "dark"
            ? "rgba(94, 234, 212, 0.5)"
            : "rgba(100, 120, 200, 0.5)",
          boxShadow: props.colorMode === "dark"
            ? "0 25px 50px -12px rgba(0, 255, 255, 0.5), 0 0 0 1px rgba(94, 234, 212, 0.3)"
            : "0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(100, 120, 200, 0.3)",
        },
        header: {
          color: props.colorMode === "dark" ? "cyan.300" : "blue.700",
          fontWeight: "bold",
          borderBottom: "1px solid",
          borderColor: props.colorMode === "dark"
            ? "rgba(94, 234, 212, 0.2)"
            : "rgba(100, 120, 200, 0.2)",
          pb: 4,
        },
        body: {
          color: props.colorMode === "dark" ? "gray.100" : "gray.800",
        },
        footer: {
          borderTop: "1px solid",
          borderColor: props.colorMode === "dark"
            ? "rgba(94, 234, 212, 0.2)"
            : "rgba(100, 120, 200, 0.2)",
          pt: 4,
        },
      }),
      sizes: {
        // Custom z-index layers for different modal types
        claimLink: {
          dialog: {
            maxW: "600px",
            zIndex: 10000,
          },
          overlay: {
            zIndex: 9999,
            bg: "rgba(0, 0, 0, 0.75)",
          },
        },
        claimDetail: {
          dialog: {
            zIndex: 9000, // High - Claim detail modals
          },
        },
        standard: {
          dialog: {
            zIndex: 1400, // Standard modals
          },
        },
      },
    },
    Card: {
      baseStyle: (props: any) => ({
        container: {
          background: props.colorMode === "dark"
            ? "radial-gradient(circle at 70% 70%, rgba(72, 187, 215, 0.25), rgba(45, 55, 72, 1))"
            : "linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(240, 245, 250, 0.9) 100%)",
          borderRadius: "2xl",
          boxShadow: props.colorMode === "dark"
            ? "lg"
            : "0 4px 20px rgba(80, 100, 180, 0.15), 0 2px 8px rgba(60, 80, 160, 0.1)",
          border: "1px solid",
          borderColor: props.colorMode === "dark" ? "gray.700" : "rgba(100, 120, 200, 0.3)",
          backdropFilter: "blur(12px)",
        },
      }),
    },
    Heading: {
      baseStyle: (props: any) => ({
        fontWeight: "bold",
        color: props.colorMode === "dark" ? "teal.300" : "#1e3a8a",
      }),
    },
    Text: {
      baseStyle: (props: any) => ({
        color: props.colorMode === "dark" ? "gray.100" : "gray.800",
      }),
    },
    Button: {
      baseStyle: (props: any) => ({
        fontWeight: "600",
        color: props.colorMode === "dark" ? undefined : "white",
      }),
    },
  },
});

export default theme;
