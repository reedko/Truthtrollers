// src/theme.ts
import { extendTheme } from "@chakra-ui/react";
const API_BASE_URL = process.env.REACT_APP_BASE_URL || "https://localhost:5001";

const theme = extendTheme({
  fonts: {
    heading: "'DM Sans', sans-serif",
    body: "'DM Sans', sans-serif",
  },
  styles: {
    global: {
      html: {
        height: "100%",
      },

      "#root": {
        height: "100%",
      },
    },
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
      cardGradient:
        "radial-gradient(circle at 70% 70%, rgba(72, 187, 215, 0.25), rgba(45, 55, 72, 1))",
      pop2Gradient:
        "radial-gradient(circle at 70% 70%, rgba(72, 187, 215, 0.25), rgba(45, 55, 72, 1))",
      popGradient:
        "radial-gradient(circle at 75% 80%, rgba(1, 17, 15, 0.5), rgba(43, 105, 82, 0.5))",
      stackGradient:
        "radial-gradient(circle at 75% 80%, rgba(136, 230, 196, 0.31), rgb(2, 0, 36))",
      statGradient:
        "radial-gradient(circle at bottom left,  rgba(0, 255, 225, 0.05) 0%,  #0a192f 20%,  #010212 50%,#000000 80%)",
      stat2Gradient:
        "linear-gradient(to top right,rgba(7, 82, 75, 0.6),rgba(137, 84, 84, 0.6))",
      stat5Gradient:
        "linear-gradient(to top right,rgba(38, 50, 44, 0.7),rgb(37, 186, 146))",
      stat6Gradient:
        "linear-gradient(to top right,rgba(113, 144, 141, 0.1),rgba(215, 226, 227, 0.5))",
      cardTeal: "teal.400",
      cardBlue: "#4682b4",
      cardGreen: "#175d48",
      cardBlue2: "#212e4d",
    },
  },
  components: {
    Card: {
      baseStyle: {
        container: {
          bgGradient:
            "radial-gradient(circle at 70% 70%, rgba(72, 187, 215, 0.25), rgba(45, 55, 72, 1))",
          borderRadius: "2xl",
          boxShadow: "lg",
          //border: "1px solid",
          borderColor: "gray.700",
        },
      },
    },
    Heading: {
      baseStyle: {
        fontWeight: "bold",
        color: "teal.300",
      },
    },
  },
});

export default theme;
