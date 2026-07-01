import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Container,
  FormControl,
  FormLabel,
  Grid,
  HStack,
  Heading,
  Input,
  Select,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Textarea,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { FiDownload, FiEdit3, FiExternalLink, FiSave, FiUploadCloud } from "react-icons/fi";
import { api } from "../services/api";
import ArticleMarkdownEditor from "../components/reviewArticles/ArticleMarkdownEditor";
import ArticleModuleSidebar from "../components/reviewArticles/ArticleModuleSidebar";
import ArticlePreview from "../components/reviewArticles/ArticlePreview";
import CopyMarkdownButton from "../components/reviewArticles/CopyMarkdownButton";
import {
  ReviewArticle,
  ReviewArticleModule,
  assembleMarkdownFromModules,
} from "../components/reviewArticles/types";

const confidenceOptions = ["High", "Medium", "Low", "Not enough linked evidence"];
const verdictOptions = [
  "Mostly supported",
  "Leans supported",
  "Mixed or qualified",
  "Leans refuted",
  "Mostly refuted",
  "Review assembled",
];

const ReviewArticleComposerPage: React.FC = () => {
  const { articleId } = useParams<{ articleId: string }>();
  const [article, setArticle] = useState<ReviewArticle | null>(null);
  const [title, setTitle] = useState("");
  const [verdict, setVerdict] = useState("");
  const [confidence, setConfidence] = useState("");
  const [summary, setSummary] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [modules, setModules] = useState<ReviewArticleModule[]>([]);
  const [previewMode, setPreviewMode] = useState<"structured" | "markdown">("structured");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingEssay, setGeneratingEssay] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/api/review-articles/${articleId}`);
        const next = response.data.article as ReviewArticle;
        setArticle(next);
        setTitle(next.title || "");
        setVerdict(next.verdict || "");
        setConfidence(next.confidence || "");
        setSummary(next.summary || "");
        setModules(next.modules_json || []);
        setBodyMarkdown(next.body_markdown || assembleMarkdownFromModules(next.modules_json || []));
        api.post(`/api/review-articles/${articleId}/ensure-assets`)
          .then((assetResponse) => {
            const hydrated = assetResponse.data.article as ReviewArticle;
            setArticle(hydrated);
            setModules(hydrated.modules_json || []);
            setBodyMarkdown(hydrated.body_markdown || assembleMarkdownFromModules(hydrated.modules_json || []));
          })
          .catch((assetError) => {
            console.warn("Could not ensure review article assets", assetError);
          });
      } catch (error: any) {
        toast({
          title: "Could not load review article",
          description: error.response?.data?.error || error.message,
          status: "error",
          duration: 5000,
        });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [articleId, toast]);

  const exportMarkdown = useMemo(() => `# ${title}\n\n${bodyMarkdown}`.trim(), [title, bodyMarkdown]);

  const saveDraft = async (status?: "draft" | "published") => {
    try {
      setSaving(true);
      const response = await api.put(`/api/review-articles/${articleId}`, {
        title,
        verdict,
        confidence,
        summary,
        body_markdown: bodyMarkdown,
        modules_json: modules,
        status: status || article?.status || "draft",
      });
      setArticle(response.data.article);
      toast({ title: "Draft saved", status: "success", duration: 2500 });
      return response.data.article as ReviewArticle;
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error.response?.data?.error || error.message,
        status: "error",
        duration: 5000,
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    const saved = await saveDraft();
    if (!saved) return;

    try {
      setSaving(true);
      const response = await api.post(`/api/review-articles/${articleId}/publish`);
      const published = response.data.article as ReviewArticle;
      setArticle(published);
      toast({ title: "Published to VeriStrata", status: "success", duration: 3000 });
      if (published.slug) navigate(`/public/reviews/${published.slug}`);
    } catch (error: any) {
      toast({
        title: "Publish failed",
        description: error.response?.data?.error || error.message,
        status: "error",
        duration: 5000,
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleModule = (id: string, enabled: boolean) => {
    const nextModules = modules.map((module) =>
      module.id === id ? { ...module, enabled } : module,
    );
    const nextBody = previewMode === "markdown"
      ? bodyMarkdown
      : assembleMarkdownFromModules(nextModules);
    setModules(nextModules);
    setBodyMarkdown(nextBody);
    setPreviewMode("structured");
    api.put(`/api/review-articles/${articleId}`, {
      title,
      verdict,
      confidence,
      summary,
      body_markdown: nextBody,
      modules_json: nextModules,
      status: article?.status || "draft",
    }).then((response) => {
      setArticle(response.data.article);
    }).catch((error) => {
      toast({
        title: "Module setting was not saved",
        description: error.response?.data?.error || error.message,
        status: "error",
        duration: 4000,
      });
    });
  };

  const updateBodyMarkdown = (value: string) => {
    setBodyMarkdown(value);
    setPreviewMode("markdown");
  };

  const generateEssayDraft = async () => {
    try {
      setGeneratingEssay(true);
      const response = await api.post(`/api/review-articles/${articleId}/generate-essay`, {
        title,
        verdict,
        confidence,
        summary,
        modules_json: modules,
      });
      const markdown = response.data?.markdown;
      if (!markdown) throw new Error("No markdown returned");
      if (Array.isArray(response.data?.modules_json)) {
        setModules(response.data.modules_json);
      }
      setBodyMarkdown(markdown);
      setPreviewMode("markdown");
      toast({
        title: "Essay draft generated",
        description: "Review the prose before publishing or exporting.",
        status: "success",
        duration: 3500,
      });
    } catch (error: any) {
      toast({
        title: "Essay generation failed",
        description: error.response?.data?.error || error.message,
        status: "error",
        duration: 6000,
      });
    } finally {
      setGeneratingEssay(false);
    }
  };

  const downloadMarkdown = () => {
    const blob = new Blob([exportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(title || "veristrata-review").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const downloadDocx = async () => {
    try {
      const response = await api.get(`/api/review-articles/${articleId}/export/docx`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(title || "veristrata-review").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.docx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        title: "DOCX export failed",
        description: error.response?.data?.error || error.message,
        status: "error",
        duration: 5000,
      });
    }
  };

  if (loading) {
    return (
      <Container maxW="container.xl" py={16}>
        <HStack justify="center">
          <Spinner color="cyan.400" />
          <Text>Loading composer...</Text>
        </HStack>
      </Container>
    );
  }

  if (!article) {
    return (
      <Container maxW="container.xl" py={16}>
        <Heading size="md">Review article not found</Heading>
      </Container>
    );
  }

  return (
    <Box className="mr-container" py={6}>
      <Container className="mr-content" maxW="1500px">
        <HStack justify="space-between" align="start" mb={5}>
          <Box>
            <Heading size="lg" className="mr-heading">
              Public Review Article Composer
            </Heading>
            <Text className="mr-text-muted" fontSize="sm">
              Edit a transparent VeriStrata article, then copy or download Markdown for manual Substack publishing.
            </Text>
          </Box>
          <HStack flexWrap="wrap" justify="flex-end">
            <Button className="mr-button" leftIcon={<FiSave />} onClick={() => saveDraft()} isLoading={saving}>
              Save Draft
            </Button>
            <Button className="mr-button" leftIcon={<FiEdit3 />} onClick={generateEssayDraft} isLoading={generatingEssay}>
              Generate Essay
            </Button>
            <Button className="mr-button" leftIcon={<FiUploadCloud />} onClick={publish} isLoading={saving}>
              Publish to VeriStrata
            </Button>
            {article.slug && (
              <Button className="mr-button" leftIcon={<FiExternalLink />} onClick={() => navigate(`/public/reviews/${article.slug}`)}>
                Public Page
              </Button>
            )}
          </HStack>
        </HStack>

        <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 1fr) 360px" }} gap={5}>
          <VStack align="stretch" spacing={4}>
            <Box className="mr-card mr-card-blue" p={4}>
              <Grid templateColumns={{ base: "1fr", md: "1fr 220px 220px" }} gap={4}>
                <FormControl>
                  <FormLabel color="cyan.300" fontSize="sm">Title</FormLabel>
                  <Input className="mr-input" value={title} onChange={(event) => setTitle(event.target.value)} />
                </FormControl>
                <FormControl>
                  <FormLabel color="cyan.300" fontSize="sm">Verdict</FormLabel>
                  <Select className="mr-input" value={verdict} onChange={(event) => setVerdict(event.target.value)}>
                    {verdictOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel color="cyan.300" fontSize="sm">Confidence</FormLabel>
                  <Select className="mr-input" value={confidence} onChange={(event) => setConfidence(event.target.value)}>
                    {confidenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </Select>
                </FormControl>
              </Grid>
              <FormControl mt={4}>
                <FormLabel color="cyan.300" fontSize="sm">Summary</FormLabel>
                <Textarea
                  className="mr-input"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  rows={3}
                />
              </FormControl>
            </Box>

            <Tabs variant="unstyled">
              <TabList>
                <Tab
                  color="var(--mr-text-muted)"
                  border="1px solid transparent"
                  borderRadius="var(--mr-radius-sm)"
                  _selected={{
                    color: "var(--mr-blue)",
                    bg: "rgba(0,162,255,0.12)",
                    borderColor: "var(--mr-blue-border)",
                    boxShadow: "0 0 18px var(--mr-blue-border)",
                  }}
                >
                  Markdown editor
                </Tab>
                <Tab
                  color="var(--mr-text-muted)"
                  border="1px solid transparent"
                  borderRadius="var(--mr-radius-sm)"
                  _selected={{
                    color: "var(--mr-blue)",
                    bg: "rgba(0,162,255,0.12)",
                    borderColor: "var(--mr-blue-border)",
                    boxShadow: "0 0 18px var(--mr-blue-border)",
                  }}
                >
                  Preview
                </Tab>
              </TabList>
              <TabPanels>
                <TabPanel px={0}>
                  <ArticleMarkdownEditor value={bodyMarkdown} onChange={updateBodyMarkdown} />
                </TabPanel>
                <TabPanel px={0}>
                  <HStack justify="flex-end" mb={3}>
                    <Button
                      size="sm"
                      className="mr-button"
                      variant="ghost"
                      onClick={() => setPreviewMode("structured")}
                      opacity={previewMode === "structured" ? 1 : 0.68}
                    >
                      Structured Graphics
                    </Button>
                    <Button
                      size="sm"
                      className="mr-button"
                      variant="ghost"
                      onClick={() => setPreviewMode("markdown")}
                      opacity={previewMode === "markdown" ? 1 : 0.68}
                    >
                      Essay Markdown
                    </Button>
                  </HStack>
                  <ArticlePreview
                    title={title}
                    markdown={bodyMarkdown}
                    modules={modules}
                    preferMarkdown={previewMode === "markdown"}
                  />
                </TabPanel>
              </TabPanels>
            </Tabs>
          </VStack>

          <VStack align="stretch" spacing={4}>
            <ArticleModuleSidebar modules={modules} onToggle={toggleModule} />
            <Box className="mr-card mr-card-green" p={4}>
              <VStack align="stretch">
                <CopyMarkdownButton markdown={exportMarkdown} />
                <Button className="mr-button" leftIcon={<FiDownload />} onClick={downloadDocx}>
                  Download DOCX
                </Button>
                <Button className="mr-button" leftIcon={<FiDownload />} onClick={downloadMarkdown}>
                  Download Markdown
                </Button>
                <Text className="mr-text-muted" fontSize="xs">
                  DOCX and Markdown exports include the current article body. DOCX also embeds enabled review images and attached graph snapshots.
                </Text>
              </VStack>
            </Box>
          </VStack>
        </Grid>
      </Container>
    </Box>
  );
};

export default ReviewArticleComposerPage;
