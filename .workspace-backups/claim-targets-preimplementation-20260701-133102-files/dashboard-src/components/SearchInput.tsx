import {
  Input,
  InputGroup,
  InputLeftElement,
  HStack,
  Switch,
  Text,
  Tooltip,
} from "@chakra-ui/react";
import { useRef, useState, useEffect } from "react";
import { BsSearch } from "react-icons/bs";
import { useNavigate } from "react-router-dom";

const SearchInput = () => {
  const ref = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [aiAnalysisEnabled, setAiAnalysisEnabled] = useState(false);

  // Load toggle state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("search_ai_analysis_enabled");
    if (saved !== null) {
      setAiAnalysisEnabled(saved === "true");
    }
  }, []);

  // Save toggle state to localStorage
  const handleToggleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    setAiAnalysisEnabled(enabled);
    localStorage.setItem("search_ai_analysis_enabled", String(enabled));
  };

  const handleSearch = () => {
    const searchQuery = ref.current?.value?.trim();

    if (searchQuery) {
      // Navigate to search results page with query parameter and AI analysis flag
      const analyzeParam = aiAnalysisEnabled ? "&analyze=true" : "";
      navigate(`/search?q=${encodeURIComponent(searchQuery)}${analyzeParam}`);

      // Clear the input after search
      if (ref.current) {
        ref.current.value = "";
      }
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    handleSearch();
  };

  return (
    <form onSubmit={handleSubmit}>
      <HStack spacing={3}>
        <InputGroup flex={1}>
          <InputLeftElement children={<BsSearch />} />
          <Input
            ref={ref}
            borderRadius={20}
            placeholder="Type a search phrase and hit enter to find related Cases"
            variant="filled"
          />
        </InputGroup>
        <Tooltip label="Enable AI-powered claim analysis (experimental)" placement="bottom">
          <HStack spacing={2} minW="100px">
            <Switch
              id="ai-analysis-toggle"
              size="sm"
              colorScheme="purple"
              isChecked={aiAnalysisEnabled}
              onChange={handleToggleChange}
            />
            <Text fontSize="xs" color="gray.400" whiteSpace="nowrap">
              AI Analysis
            </Text>
          </HStack>
        </Tooltip>
      </HStack>
    </form>
  );
};

export default SearchInput;
