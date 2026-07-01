import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider, Box } from "@chakra-ui/react";
import theme from "./components/themes/VisionTheme";
import "./components/Popup.css";
import "./styles/minorityReport.css";

// Import only the UI components we need
import VerimeterMeter from "./components/VerimeterMeter";
import resizeImage from "./services/image-url";
import TruthGauge from "./components/ModernArcGauge";

// Simple mock TaskCard component - no extension dependencies
const SimpleTaskCard: React.FC = () => {
  const logo = "/assets/images/miniLogo.png";
  const imageUrl = "/assets/images/content/content_id_14894.png";

  // Mock claim pairs data
  const claimPairsData = {
    overall_verimeter: 0.75,
    claim_pairs: [
      {
        caseClaim: {
          claim_id: 1,
          claim_text: "Global temperatures have risen by 1.1°C since pre-industrial times",
          publisher: "nasa.gov",
          url: "https://nasa.gov/climate",
        },
        sourceClaim: {
          claim_id: 2,
          claim_text: "Multiple studies confirm warming trend across all continents",
          publisher: "ipcc.ch",
          url: "https://ipcc.ch/report",
          relationship: "supports",
        },
        verimeter_score: 0.85,
        support_level: 0.9,
        rationale: "Multiple independent temperature records show consistent warming patterns.",
      },
      {
        caseClaim: {
          claim_id: 3,
          claim_text: "Arctic sea ice is declining at unprecedented rates",
          publisher: "noaa.gov",
          url: "https://noaa.gov/arctic",
        },
        sourceClaim: {
          claim_id: 4,
          claim_text: "Satellite observations show 13% decline per decade since 1979",
          publisher: "nsidc.org",
          url: "https://nsidc.org/data",
          relationship: "supports",
        },
        verimeter_score: 0.78,
        support_level: 0.85,
        rationale: "Satellite data provides direct measurement of ice extent showing consistent decline.",
      },
      {
        caseClaim: {
          claim_id: 5,
          claim_text: "CO2 levels are at highest point in 800,000 years",
          publisher: "climate.gov",
          url: "https://climate.gov/co2",
        },
        sourceClaim: {
          claim_id: 6,
          claim_text: "Ice core data shows current levels exceed natural variation",
          publisher: "nature.com",
          url: "https://nature.com/articles/climate",
          relationship: "supports",
        },
        verimeter_score: 0.92,
        support_level: 0.95,
        rationale: "Ice core samples provide historical CO2 records showing unprecedented modern levels.",
      },
    ],
  };

  return (
    <Box
      className="popup-box"
      width="300px"
      position="relative"
      sx={{
        backgroundImage: `
          linear-gradient(135deg, rgba(10, 30, 60, 0.75), rgba(20, 50, 80, 0.7)),
          repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.08) 2px, rgba(0, 162, 255, 0.08) 4px)
        `,
      }}
      border="1px solid rgba(0, 162, 255, 0.6)"
      borderRadius="12px"
      boxShadow="0 10px 40px rgba(0, 0, 0, 0.7), 0 0 50px rgba(0, 162, 255, 0.6), inset 0 2px 0 rgba(255, 255, 255, 0.2)"
      overflow="hidden"
      p={3}
    >
      <Box
        position="absolute"
        left={0}
        top={0}
        width="50px"
        height="100%"
        background="linear-gradient(90deg, rgba(0, 217, 255, 0.6) 0%, rgba(0, 217, 255, 0.4) 25%, rgba(0, 217, 255, 0.25) 50%, rgba(0, 217, 255, 0.1) 75%, transparent 100%)"
        pointerEvents="none"
      />
      <Box
        position="relative"
        zIndex={1}
        style={{ background: "none" }}
        width="100%"
      >
        {/* Logo box */}
        <Box
          className="logo-box"
          position="relative"
          background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
          border="1px solid rgba(0, 162, 255, 0.4)"
          borderRadius="12px"
          boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
          overflow="hidden"
          p={2}
          width="100%"
          mb={2}
        >
          <Box
            position="absolute"
            left={0}
            top={0}
            width="30px"
            height="100%"
            background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
            pointerEvents="none"
          />
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            position="relative"
            zIndex={1}
          >
            <Box flexShrink={0}>{logo && resizeImage(40, logo)}</Box>
            <Box
              color="#00a2ff"
              fontWeight="400"
              letterSpacing="2px"
              textTransform="uppercase"
              fontSize="lg"
              fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
            >
              TruthTrollers
            </Box>
          </Box>
        </Box>

        {/* Meters */}
        <Box display="flex" gap={1} justifyContent="space-between" alignItems="flex-start" mt={2} px={1}>
          <Box flexShrink={0}>
            <TruthGauge
              score={0.75}
              label="VERIMETER"
              size={{ w: 170, h: 90 }}
              normalize={false}
            />
          </Box>
          <Box
            position="relative"
            background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
            border="1px solid rgba(0, 162, 255, 0.5)"
            borderRadius="12px"
            boxShadow="0 10px 40px rgba(0, 0, 0, 0.7), 0 0 50px rgba(0, 162, 255, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
            overflow="hidden"
            flexShrink={0}
            width="70px"
            height="180px"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Box
              position="absolute"
              left={0}
              top={0}
              width="15px"
              height="100%"
              background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
              pointerEvents="none"
            />
            <Box
              color="white"
              fontSize="xs"
              textAlign="center"
              position="relative"
              zIndex={1}
            >
              CROWD<br/>121
            </Box>
          </Box>
        </Box>

        {/* Claim Pairs - Import the actual component */}
        <Box width="100%" mt={2}>
          <ClaimPairsDetailInline claimPairsData={claimPairsData} />
        </Box>

        {/* Title and Buttons */}
        <Box width="280px" mt={2}>
          <Box
            fontSize="lg"
            fontWeight="bold"
            color="white"
            px={1}
            mb={2}
            fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
          >
            Test Article: Climate Change Evidence
          </Box>

          <Box display="flex" gap={3} justifyContent="center" mt={3}>
            <button className="mr-button" onClick={() => alert("Discuss clicked")}>
              <span style={{ position: "relative", zIndex: 1 }}>Discuss</span>
            </button>
            <button className="mr-button" onClick={() => alert("Close clicked")}>
              <span style={{ position: "relative", zIndex: 1 }}>Close</span>
            </button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

// Inline simplified ClaimPairsDetail to avoid extension dependencies
const ClaimPairsDetailInline: React.FC<{ claimPairsData: any }> = ({ claimPairsData }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [expandedPairId, setExpandedPairId] = React.useState<string | null>(null);

  const getPublisherIconUrl = (publisher: string) => {
    const domain = publisher.replace(/^www\./, "");
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  };

  return (
    <Box width="100%" mt={2} className="mr-card mr-card-blue">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="mr-button"
        style={{
          width: "100%",
          fontFamily: "Futura, 'Century Gothic', 'Avenir Next', sans-serif",
        }}
      >
        <span style={{ position: "relative", zIndex: 1 }}>
          {isOpen ? "▼" : "▶"} {isOpen ? "Hide" : "Show"} Top Claims
        </span>
      </button>

      {isOpen && (
        <Box
          mt={2}
          p={2}
          position="relative"
          background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
          border="1px solid rgba(0, 162, 255, 0.4)"
          borderRadius="12px"
          boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
          maxH="300px"
          overflowY="auto"
        >
          <Box
            position="absolute"
            left={0}
            top={0}
            width="30px"
            height="100%"
            background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
            pointerEvents="none"
            zIndex={0}
          />
          <Box position="relative" zIndex={1}>
            {claimPairsData.claim_pairs.map((pair: any, idx: number) => {
              const pairKey = `${pair.caseClaim.claim_id}-${pair.sourceClaim.claim_id}`;
              const isExpanded = expandedPairId === pairKey;
              const isSupport = pair.verimeter_score > 0.1;
              const isRefute = pair.verimeter_score < -0.1;

              return (
                <Box
                  key={pairKey}
                  mb={2}
                  position="relative"
                  background="linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.85))"
                  borderRadius="12px"
                  border="1px solid"
                  borderColor={
                    isSupport
                      ? "rgba(97, 239, 184, 0.4)"
                      : isRefute
                        ? "rgba(255, 108, 136, 0.4)"
                        : "rgba(0, 162, 255, 0.4)"
                  }
                  overflow="hidden"
                  cursor="pointer"
                  onClick={() => setExpandedPairId(isExpanded ? null : pairKey)}
                >
                  <Box p={2}>
                    {/* Verimeter score */}
                    <Box mb={1}>
                      <VerimeterMeter
                        score={pair.verimeter_score}
                        width="100%"
                        showInterpretation={false}
                      />
                    </Box>

                    {/* Claims row */}
                    <Box display="flex" gap={2} fontSize="10px" alignItems="center">
                      <Box flex={1} display="flex" gap={1} alignItems="center" minW={0}>
                        <img
                          src={getPublisherIconUrl(pair.caseClaim.publisher)}
                          alt={pair.caseClaim.publisher}
                          style={{ width: "10px", height: "10px", borderRadius: "2px" }}
                        />
                        <Box
                          color="#b4c9e0"
                          fontWeight="500"
                          overflow="hidden"
                          textOverflow="ellipsis"
                          whiteSpace="nowrap"
                          fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                        >
                          {pair.caseClaim.claim_text}
                        </Box>
                      </Box>

                      <Box width="1px" height="12px" bg="rgba(0, 162, 255, 0.3)" />

                      <Box flex={1} display="flex" gap={1} alignItems="center" minW={0}>
                        <img
                          src={getPublisherIconUrl(pair.sourceClaim.publisher)}
                          alt={pair.sourceClaim.publisher}
                          style={{ width: "10px", height: "10px", borderRadius: "2px" }}
                        />
                        <Box
                          color="#b4c9e0"
                          fontWeight="500"
                          overflow="hidden"
                          textOverflow="ellipsis"
                          whiteSpace="nowrap"
                          fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
                        >
                          {pair.sourceClaim.claim_text}
                        </Box>
                      </Box>

                      <Box fontSize="xs" color="#89a9bf">
                        {isExpanded ? "▼" : "▶"}
                      </Box>
                    </Box>

                    {/* Expanded details */}
                    {isExpanded && (
                      <Box
                        mt={2}
                        p={3}
                        bg="rgba(0, 0, 0, 0.4)"
                        borderTop="1px solid rgba(255, 255, 255, 0.05)"
                        borderRadius="8px"
                      >
                        <Box mb={2}>
                          <Box fontSize="9px" color="#89a9bf" mb={1} fontWeight="600">
                            CASE CLAIM
                          </Box>
                          <Box fontSize="11px" color="#d4e9ff" lineHeight="1.5">
                            {pair.caseClaim.claim_text}
                          </Box>
                        </Box>

                        <Box mb={2}>
                          <Box fontSize="9px" color="#89a9bf" mb={1} fontWeight="600">
                            SOURCE CLAIM
                          </Box>
                          <Box fontSize="11px" color="#d4e9ff" lineHeight="1.5">
                            {pair.sourceClaim.claim_text}
                          </Box>
                        </Box>

                        {pair.rationale && (
                          <Box>
                            <Box fontSize="9px" color="#89a9bf" mb={1} fontWeight="600">
                              RATIONALE
                            </Box>
                            <Box fontSize="10px" color="#b4c9e0" lineHeight="1.5" fontStyle="italic">
                              {pair.rationale}
                            </Box>
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
};

const App = () => {
  return (
    <ChakraProvider theme={theme}>
      <Box
        minH="100vh"
        p={8}
        background="linear-gradient(45deg, #1a202c, #2d3748, #1a365d)"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <SimpleTaskCard />
      </Box>
    </ChakraProvider>
  );
};

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
