import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge, Box, Container, Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { api } from "../services/api";
import ArticlePreview from "../components/reviewArticles/ArticlePreview";
import { ReviewArticle } from "../components/reviewArticles/types";

const PublicReviewArticlePage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<ReviewArticle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await api.get(`/api/public/review-articles/${slug}`);
        setArticle(response.data.article);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug]);

  if (loading) {
    return (
      <Container maxW="container.lg" py={16}>
        <HStack justify="center">
          <Spinner color="cyan.400" />
          <Text>Loading public review...</Text>
        </HStack>
      </Container>
    );
  }

  if (!article) {
    return (
      <Container maxW="container.lg" py={16}>
        <Heading size="md">Published review not found</Heading>
      </Container>
    );
  }

  return (
    <Box className="mr-container" py={8}>
      <Container className="mr-content" maxW="980px">
        <VStack align="stretch" spacing={5}>
          <HStack justify="space-between">
            <Box>
              <Text fontSize="xs" color="var(--mr-blue)" textTransform="uppercase" letterSpacing="0.08em">
                VeriStrata Public Review
              </Text>
              <Heading size="lg" className="mr-heading">{article.title}</Heading>
            </Box>
            <Badge
              bg="rgba(34,197,94,0.14)"
              color="var(--mr-green)"
              border="1px solid var(--mr-green-border)"
              boxShadow="0 0 12px var(--mr-green-border)"
            >
              Published
            </Badge>
          </HStack>
          <ArticlePreview title={article.title} markdown={article.body_markdown || ""} modules={article.modules_json || []} />
        </VStack>
      </Container>
    </Box>
  );
};

export default PublicReviewArticlePage;
