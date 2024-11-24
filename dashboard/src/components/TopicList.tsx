import {
  Button,
  HStack,
  Heading,
  Image,
  List,
  ListItem,
  Spinner,
} from "@chakra-ui/react";
import { useState } from "react";
const BASE_URL = process.env.BASE_URL || "http://localhost:5001";

interface TopicListProps {
  topics: string[];
  subtopics: string[];
  onTopicSelect: (topic: string | undefined, subtopic?: string) => void; // Callback for selection
}
const TopicList: React.FC<TopicListProps> = ({
  topics,
  subtopics,
  onTopicSelect,
}) => {
  const [selectedTopic, setSelectedTopic] = useState<string | undefined>(
    undefined
  );
  const [selectedSubtopic, setSelectedSubtopic] = useState<string | undefined>(
    undefined
  );

  const handleTopicClick = (topic: string) => {
    setSelectedTopic(topic);
    onTopicSelect(topic); // Call parent function
  };

  const handleReset = () => {
    setSelectedTopic(undefined); // Reset the selection
    onTopicSelect(undefined); // Notify parent to reset tasks display
  };

  const handleSubtopicChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const subtopic = event.target.value;
    setSelectedSubtopic(subtopic);
    if (selectedTopic) {
      onTopicSelect(selectedTopic, subtopic); // Call parent function
    }
  };

  return (
    <>
      <Heading fontSize="2xl" marginBottom={3}>
        Topics
      </Heading>
      <List>
        <ListItem>
          <Button onClick={handleReset} variant="outline" colorScheme="red">
            All Topics
          </Button>{" "}
          {/* Reset Button */}
        </ListItem>
        {topics.map((topic, index) => (
          <ListItem key={index} paddingY="5px">
            <HStack>
              <Image
                src={`{`${BASE_URL}${topics.thumbnail}${topic}.png`} // Assuming thumbnail images are named as topic.webp
                alt="Thumbnail"
                borderRadius="md"
                boxSize="50px"
                objectFit="cover"
              />
              <Button
                whiteSpace={"normal"}
                textAlign={"left"}
                fontWeight={topic === selectedTopic ? "bold" : "normal"}
                onClick={() => handleTopicClick(topic)}
                fontSize="lg"
                variant="link"
              >
                {topic}
              </Button>
            </HStack>
          </ListItem>
        ))}
      </List>
    </>
  );
};

export default TopicList;
