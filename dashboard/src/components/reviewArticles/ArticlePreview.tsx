import React from "react";
import { Box, Heading, Image, Text, VStack } from "@chakra-ui/react";
import ClaimLinkArticleCard from "./ClaimLinkArticleCard";
import KnowledgeGraphSnapshotGraphic from "./KnowledgeGraphSnapshotGraphic";
import PublicationEvidenceMap from "./PublicationEvidenceMap";
import PublisherRatingGraphic from "./PublisherRatingGraphic";
import { ReviewArticleModule } from "./types";

interface ArticlePreviewProps {
  title: string;
  markdown: string;
  modules?: ReviewArticleModule[];
  preferMarkdown?: boolean;
}

const renderLine = (line: string, index: number) => {
  if (line.startsWith("## ")) {
    return <Heading key={index} size="md" color="var(--mr-blue)" mt={6}>{line.replace(/^## /, "")}</Heading>;
  }
  if (line.startsWith("### ")) {
    return <Heading key={index} size="sm" color="var(--mr-text-primary)" mt={4}>{line.replace(/^### /, "")}</Heading>;
  }
  if (line.startsWith("* ")) {
    return <Text key={index} fontSize="sm" color="var(--mr-text-secondary)" pl={4}>{line}</Text>;
  }
  if (!line.trim()) {
    return <Box key={index} h={2} />;
  }
  return <Text key={index} fontSize="sm" color="var(--mr-text-primary)" whiteSpace="pre-wrap">{line}</Text>;
};

const getClaimLinksFromModules = (modules: ReviewArticleModule[]) => {
  const claimModule = modules.find((module) => module.type === "claim_link_analysis" || module.type === "claim_analysis");
  if (Array.isArray(claimModule?.data?.claim_links)) return claimModule.data.claim_links;
  if (Array.isArray(claimModule?.data?.links)) return claimModule.data.links;
  return [];
};

const renderModule = (module: ReviewArticleModule, allModules: ReviewArticleModule[]) => {
  const visualImageUrl = module.asset?.image_url || module.asset?.public_image_url;
  if (module.type === "visual" && visualImageUrl) {
    const asset = module.asset;
    return (
      <Box key={module.id} className="mr-card" p={4}>
        <VStack align="stretch" spacing={3}>
          <Heading size="md" color="var(--mr-blue)">
            {module.title}
          </Heading>
          <Image
            src={visualImageUrl}
            alt={asset?.alt || module.title}
            borderRadius="var(--mr-radius-sm)"
            border="1px solid var(--mr-blue-border)"
            bg="rgba(15,23,42,0.6)"
          />
          {asset?.caption && (
            <Text color="var(--mr-text-muted)" fontSize="sm">
              {asset.caption}
            </Text>
          )}
        </VStack>
      </Box>
    );
  }

  if (module.id === "evidence_map_image") {
    const links = Array.isArray(module.data?.graph_snapshot?.claim_links)
      ? module.data.graph_snapshot.claim_links
      : getClaimLinksFromModules(allModules);

    return (
      <PublicationEvidenceMap
        key={module.id}
        claimLinks={links}
        canonicalUrl={module.data?.canonical_evidence_map_url}
      />
    );
  }

  if (module.id === "knowledge_graph_image") {
    const fallbackClaimLinks = getClaimLinksFromModules(allModules);
    return (
      <KnowledgeGraphSnapshotGraphic
        key={module.id}
        contentTitle={module.data?.content?.content_name || module.data?.content?.title}
        author={module.data?.author}
        publisher={module.data?.publisher}
        claimLinks={Array.isArray(module.data?.claim_links) ? module.data.claim_links : fallbackClaimLinks}
        sourcesUsed={module.data?.sources_used || new Set(fallbackClaimLinks.map((link: any) => link.source_url || link.source_title).filter(Boolean)).size}
      />
    );
  }

  if (module.type === "publisher_context_graphic") {
    return (
      <PublisherRatingGraphic
        key={module.id}
        context={module.data?.publisher_context || module.data}
      />
    );
  }

  if (module.type === "claim_link_analysis" || module.type === "claim_analysis") {
    const links = Array.isArray(module.data?.claim_links)
      ? module.data.claim_links
      : Array.isArray(module.data?.links)
        ? module.data.links
        : [];

    return (
      <Box key={module.id}>
        <Heading size="md" color="var(--mr-blue)" mb={3}>
          Claim-link analysis
        </Heading>
        <VStack align="stretch" spacing={3}>
          {links.length ? (
            links.map((link, index) => (
              <ClaimLinkArticleCard
                key={link.id || link.claim_link_id || `${module.id}-${index}`}
                link={link}
                index={index}
              />
            ))
          ) : (
            <Text color="var(--mr-text-muted)" fontSize="sm">
              No user-created claim links were available for this review.
            </Text>
          )}
        </VStack>
      </Box>
    );
  }

  if (module.type === "evidence_map_snapshot") {
    const links = Array.isArray(module.data?.graph_snapshot?.claim_links)
      ? module.data.graph_snapshot.claim_links
      : getClaimLinksFromModules(allModules);

    return (
      <PublicationEvidenceMap
        key={module.id}
        claimLinks={links}
        canonicalUrl={module.data?.canonical_evidence_map_url}
      />
    );
  }

  if (module.type === "knowledge_graph_snapshot") {
    const fallbackClaimLinks = getClaimLinksFromModules(allModules);
    return (
      <KnowledgeGraphSnapshotGraphic
        key={module.id}
        contentTitle={module.data?.content?.content_name || module.data?.content?.title}
        author={module.data?.author}
        publisher={module.data?.publisher}
        claimLinks={Array.isArray(module.data?.claim_links) ? module.data.claim_links : fallbackClaimLinks}
        sourcesUsed={module.data?.sources_used || new Set(fallbackClaimLinks.map((link: any) => link.source_url || link.source_title).filter(Boolean)).size}
      />
    );
  }

  return (
    <VStack key={module.id} align="stretch" spacing={1}>
      {(module.markdown || "").split("\n").map(renderLine)}
    </VStack>
  );
};

const ArticlePreview: React.FC<ArticlePreviewProps> = ({ title, markdown, modules, preferMarkdown = false }) => {
  const enabledModules = [...(modules || [])]
    .filter((module) => module.enabled && !module.hidden && module.id !== "publisher_admiralty_crests")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const shouldRenderModules = enabledModules.length > 0 && !preferMarkdown;

  return (
    <Box className="mr-card mr-card-blue" p={6}>
      <Heading size="lg" className="mr-heading" mb={2}>
        {title}
      </Heading>
      {shouldRenderModules ? (
        <VStack align="stretch" spacing={5}>
          {enabledModules.map((module) => renderModule(module, enabledModules))}
        </VStack>
      ) : (
        <VStack align="stretch" spacing={1}>
          {markdown.split("\n").map(renderLine)}
        </VStack>
      )}
    </Box>
  );
};

export default ArticlePreview;
