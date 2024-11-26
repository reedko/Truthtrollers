// ./src/components/TopicList.tsx
import {
  Button,
  HStack,
  Heading,
  List,
  ListItem,
  Image,
} from "@chakra-ui/react";
import { useTopicsStore } from "../store/useTopicStore";

const TopicList: React.FC = () => {
  const topics = useTopicsStore((state) => state.topics);
  const subtopics = useTopicsStore((state) => state.subtopics);
  const setSelectedTopic = useTopicsStore((state) => state.setSelectedTopic);
  const setSelectedSubtopic = useTopicsStore(
    (state) => state.setSelectedSubtopic
  );

  const handleTopicClick = (topic: string) => {
    setSelectedTopic(topic);
    setSelectedSubtopic(undefined); // Reset subtopic
  };

  const handleReset = () => {
    setSelectedTopic(undefined);
    setSelectedSubtopic(undefined);
  };
  const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";
  return (
    <>
      <Heading fontSize="2xl" marginBottom={3}>
        Topics
      </Heading>
      <List>
        <ListItem>
          <Button onClick={handleReset} variant="outline" colorScheme="red">
            All Topics
          </Button>
        </ListItem>
        {topics.map((topic) => (
          <ListItem key={topic.topic_id} paddingY="5px">
            <HStack>
              <Image
                src={`${API_BASE_URL}/${topic.thumbnail}`}
                alt={topic.topic_name.toUpperCase()}
                backgroundColor="teal"
                borderRadius="md"
                boxSize="50px"
              />
              <Button
                height={10}
                whiteSpace="normal"
                textAlign="left"
                fontWeight="bold"
                onClick={() => handleTopicClick(topic.topic_name)}
              >
                {topic.topic_name.toUpperCase()}
              </Button>
            </HStack>
          </ListItem>
        ))}
      </List>
    </>
  );
};

export default TopicList;
