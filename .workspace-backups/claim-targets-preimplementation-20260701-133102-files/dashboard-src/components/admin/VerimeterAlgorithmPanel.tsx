import React, { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Grid,
  HStack,
  Heading,
  Input,
  NumberInput,
  NumberInputField,
  Switch,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { api } from "../../services/api";

type ComponentKey = "source_crest" | "reviewer_reputation" | "publisher_rating" | "author_rating";

type Policy = {
  components: Record<ComponentKey, { enabled: boolean; multiplier: number }>;
  source_crest: {
    letter: Record<string, number>;
    number: Record<string, number>;
  };
  missing: Record<ComponentKey, number>;
};

const labels: Record<ComponentKey, string> = {
  source_crest: "SourceCrest",
  reviewer_reputation: "Reviewer Reputation",
  publisher_rating: "Publisher Rating",
  author_rating: "Author Rating",
};

export default function VerimeterAlgorithmPanel() {
  const toast = useToast();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [previewContentId, setPreviewContentId] = useState("15225");
  const [previewUserId, setPreviewUserId] = useState("1");
  const [preview, setPreview] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPolicy();
  }, []);

  const activeFormula = useMemo(() => {
    if (!policy) return "";
    const factors = (Object.keys(policy.components) as ComponentKey[])
      .filter((key) => policy.components[key].enabled)
      .map((key) => `${key}_factor`);
    return `sum(support_level * ${factors.join(" * ") || "1"}) / sum(${factors.join(" * ") || "1"})`;
  }, [policy]);

  const loadPolicy = async () => {
    const res = await api.get("/api/admin/verimeter-policy");
    setPolicy(res.data.policy);
  };

  const savePolicy = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const res = await api.put("/api/admin/verimeter-policy", { policy });
      setPolicy(res.data.policy);
      toast({ title: "Verimeter policy saved", status: "success", duration: 2500 });
    } catch (err) {
      toast({ title: "Failed to save Verimeter policy", status: "error", duration: 3000 });
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    const params: Record<string, string> = { contentId: previewContentId };
    if (previewUserId) params.userId = previewUserId;
    const res = await api.get("/api/admin/verimeter-policy/preview", { params });
    setPreview(res.data.score);
  };

  const setComponent = (key: ComponentKey, patch: Partial<{ enabled: boolean; multiplier: number }>) => {
    if (!policy) return;
    setPolicy({
      ...policy,
      components: {
        ...policy.components,
        [key]: { ...policy.components[key], ...patch },
      },
    });
  };

  const setCrest = (group: "letter" | "number", key: string, value: number) => {
    if (!policy) return;
    setPolicy({
      ...policy,
      source_crest: {
        ...policy.source_crest,
        [group]: { ...policy.source_crest[group], [key]: value },
      },
    });
  };

  if (!policy) return <Text color="gray.400">Loading Verimeter policy...</Text>;

  return (
    <VStack align="stretch" spacing={6}>
      <Card className="mr-card mr-card-blue" bg="transparent" borderRadius="8px">
        <CardHeader>
          <Heading size="md" className="mr-heading">Verimeter Algorithm</Heading>
        </CardHeader>
        <CardBody>
          <VStack align="stretch" spacing={4}>
            <Text className="mr-text-secondary">
              The user-link Verimeter starts with each user-created claim link strength. It then adjusts that link's influence using enabled credibility factors. Missing ratings are neutral, not negative.
            </Text>
            <Box p={4} border="1px solid rgba(0,162,255,0.28)" borderRadius="8px" bg="rgba(15,23,42,0.55)">
              <Text fontSize="xs" color="cyan.300" textTransform="uppercase" mb={2}>Current formula</Text>
              <Text color="white" fontFamily="mono" fontSize="sm">{activeFormula}</Text>
            </Box>
            <Text fontSize="sm" color="gray.400">
              Available but optional: publisher and author ratings are reputation-weighted by the users who created those ratings. They start disabled because SourceCrest is currently the stronger source-context signal.
            </Text>
          </VStack>
        </CardBody>
      </Card>

      <Card className="mr-card mr-card-purple" bg="transparent" borderRadius="8px">
        <CardHeader>
          <Heading size="sm" className="mr-heading">Factors</Heading>
        </CardHeader>
        <CardBody>
          <Table size="sm" variant="simple">
            <Thead>
              <Tr>
                <Th color="gray.400">Factor</Th>
                <Th color="gray.400">Enabled</Th>
                <Th color="gray.400">Multiplier</Th>
                <Th color="gray.400">Missing Data</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(Object.keys(policy.components) as ComponentKey[]).map((key) => (
                <Tr key={key}>
                  <Td color="white">{labels[key]}</Td>
                  <Td><Switch isChecked={policy.components[key].enabled} onChange={(e) => setComponent(key, { enabled: e.target.checked })} /></Td>
                  <Td>
                    <NumberInput size="sm" maxW="120px" value={policy.components[key].multiplier} step={0.05} onChange={(_, v) => setComponent(key, { multiplier: Number.isFinite(v) ? v : 0 })}>
                      <NumberInputField />
                    </NumberInput>
                  </Td>
                  <Td><Badge colorScheme="green">neutral {policy.missing[key]}</Badge></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <Card className="mr-card mr-card-green" bg="transparent" borderRadius="8px">
        <CardHeader>
          <Heading size="sm" className="mr-heading">SourceCrest Mapping</Heading>
        </CardHeader>
        <CardBody>
          <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={5}>
            <Box>
              <Text color="cyan.300" fontSize="sm" mb={2}>Reliability Letter</Text>
              <HStack wrap="wrap">
                {Object.entries(policy.source_crest.letter).map(([key, value]) => (
                  <HStack key={key} spacing={1}>
                    <Badge>{key}</Badge>
                    <NumberInput size="xs" w="82px" value={value} step={0.05} onChange={(_, v) => setCrest("letter", key, Number.isFinite(v) ? v : 1)}>
                      <NumberInputField />
                    </NumberInput>
                  </HStack>
                ))}
              </HStack>
            </Box>
            <Box>
              <Text color="cyan.300" fontSize="sm" mb={2}>Confidence Number</Text>
              <HStack wrap="wrap">
                {Object.entries(policy.source_crest.number).map(([key, value]) => (
                  <HStack key={key} spacing={1}>
                    <Badge>{key}</Badge>
                    <NumberInput size="xs" w="82px" value={value} step={0.05} onChange={(_, v) => setCrest("number", key, Number.isFinite(v) ? v : 1)}>
                      <NumberInputField />
                    </NumberInput>
                  </HStack>
                ))}
              </HStack>
            </Box>
          </Grid>
        </CardBody>
      </Card>

      <Card className="mr-card mr-card-yellow" bg="transparent" borderRadius="8px">
        <CardHeader>
          <Heading size="sm" className="mr-heading">Calculation Preview</Heading>
        </CardHeader>
        <CardBody>
          <VStack align="stretch" spacing={4}>
            <HStack>
              <Input value={previewContentId} onChange={(e) => setPreviewContentId(e.target.value)} placeholder="content_id" maxW="160px" />
              <Input value={previewUserId} onChange={(e) => setPreviewUserId(e.target.value)} placeholder="user_id optional" maxW="160px" />
              <Button className="mr-button" onClick={runPreview}>Preview</Button>
              <Button className="mr-button" onClick={savePolicy} isLoading={saving}>Save Policy</Button>
            </HStack>
            {preview && (
              <Box>
                <Text color="white" mb={2}>
                  Score: <Badge colorScheme={preview.verimeter_score < 0 ? "red" : "green"}>{Math.round(preview.verimeter_score * 100)}%</Badge>
                  {" "}from {preview.link_count} links
                </Text>
                <Table size="sm">
                  <Thead>
                    <Tr>
                      <Th color="gray.400">Link</Th>
                      <Th color="gray.400">Source Claim</Th>
                      <Th color="gray.400">Strength</Th>
                      <Th color="gray.400">Weight</Th>
                      <Th color="gray.400">Weighted</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {(preview.explanation || []).map((link: any) => (
                      <Tr key={link.claim_link_id}>
                        <Td color="gray.300">{link.claim_link_id}</Td>
                        <Td color="gray.300">{link.source_claim_id}</Td>
                        <Td color={link.support_level < 0 ? "red.300" : "green.300"}>{Number(link.support_level).toFixed(2)}</Td>
                        <Td color="gray.300">{Number(link.weight).toFixed(3)}</Td>
                        <Td color="gray.300">{Number(link.weighted_score).toFixed(3)}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            )}
          </VStack>
        </CardBody>
      </Card>
    </VStack>
  );
}
