import {
  Button,
  HStack,
  Heading,
  Image,
  List,
  ListItem,
  VStack,
} from "@chakra-ui/react";
import { useTopicsStore } from "../store/useTopicStore";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface TopicListProps {
  onTopicSelect: (topic: string | undefined, subtopic?: string) => void;
}

const TopicList: React.FC<TopicListProps> = ({ onTopicSelect }) => {
  const {
    topics,
    subtopics,
    selectedTopic,
    setSelectedTopic,
    setSelectedSubtopic,
  } = useTopicsStore();

  const handleTopicClick = (topic: string) => {
    setSelectedTopic(topic);
    setSelectedSubtopic(undefined); // Clear subtopic selection
    onTopicSelect(topic); // Notify parent about the selection
  };

  const handleSubtopicClick = (subtopic: string) => {
    setSelectedSubtopic(subtopic);
    onTopicSelect(selectedTopic, subtopic); // Notify parent about the subtopic selection
  };

  const handleReset = () => {
    setSelectedTopic(undefined);
    setSelectedSubtopic(undefined);
    onTopicSelect(undefined); // Reset selection in the parent
  };

  return (
    <VStack align="stretch" spacing={3} width="100%" maxWidth="300px">
      <Heading size="lg" marginBottom={3}>
        Topics
      </Heading>
      <List spacing={3}>
        <ListItem>
          <Button onClick={handleReset} variant="outline" colorScheme="red">
            All Topics
          </Button>
        </ListItem>
        {topics.map((topic) => (
          <ListItem key={topic.topic_id}>
            <HStack alignItems="start" spacing={2}>
              <Image
                src={`${API_BASE_URL}/${topic.thumbnail}`} // Simplified image source
                alt={`${topic.topic_name} Thumbnail`}
                borderRadius="md"
                boxSize="50px"
                objectFit="cover"
                backgroundColor={"teal.50"}
              />
              <Button
                justifyContent="start"
                textAlign="left"
                fontWeight={
                  topic.topic_name === selectedTopic ? "bold" : "normal"
                }
                onClick={() => handleTopicClick(topic.topic_name)}
                fontSize="lg"
                variant="ghost"
                flex="1"
                minWidth="200px"
                padding={0}
                _hover={{ backgroundColor: "gray.400" }}
              >
                {topic.topic_name.toUpperCase()}
              </Button>
            </HStack>
            {/* Display subtopics if this topic is selected */}
          </ListItem>
        ))}
      </List>
    </VStack>
  );
};

export default TopicList;
