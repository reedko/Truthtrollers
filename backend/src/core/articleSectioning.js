/**
 * articleSectioning.js
 *
 * Reusable module for building semantic sections from article body HTML.
 *
 * Responsibilities:
 * - Extract block atoms from HTML (paragraphs, headings, blockquotes, etc.)
 * - Build semantic sections using v2 boundary rules
 * - Preserve coherence: keep headings with content, preserve quotes, use hysteresis
 * - Return structured section data suitable for extraction
 *
 * Usage:
 * const sectioner = new ArticleSectioning();
 * const result = await sectioner.section(bodyHtml);
 * // Returns: { sections, blocks, diagnostics }
 */

import * as cheerio from "cheerio";

export class ArticleSectioning {
  constructor(options = {}) {
    // V2 tuned configuration
    this.config = {
      minSectionChars: options.minSectionChars ?? 1000,
      targetSectionChars: options.targetSectionChars ?? 3200,
      maxSectionChars: options.maxSectionChars ?? 4500,
      boundaryHysteresis: options.boundaryHysteresis ?? 3,
      overlapBlocksWhenForcedSplit: options.overlapBlocksWhenForcedSplit ?? 1,
    };

    this.blockTags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "figcaption", "table", "pre"];

    this.strongHeadingMarkers = [
      "THE FACTS",
      "KEY CLAIM",
      "EVIDENCE",
      "BACKGROUND",
      "METHODOLOGY",
      "SECTION",
    ];

    this.topicShiftCues = options.topicShiftCues ?? [
      "That brings us to",
      "Which brings us",
      "Now",
      "The next claim",
      "Regarding",
      "Findings from",
      "Given the",
      "Instead",
    ];

    // Domain names must be supplied by a caller from the current article or a
    // generic configuration. Hard-coded fixture vocabulary silently changes
    // section boundaries and can leak into downstream model context.
    this.namedClusters = options.namedClusters ?? [];
  }

  /**
   * Build semantic sections from HTML body.
   */
  async section(bodyHtml) {
    const $ = cheerio.load(bodyHtml);

    // Extract block atoms
    const blocks = this.extractBlocks($);

    // Build semantic sections
    const sections = this.buildSections(blocks);

    const diagnostics = {
      blockCount: blocks.length,
      sectionCount: sections.length,
      config: this.config,
    };

    return { sections, blocks, diagnostics };
  }

  /**
   * Extract block atoms from HTML.
   */
  extractBlocks($) {
    const blocks = [];
    let charOffset = 0;

    // Get root element and traverse with cheerio
    const traverse = ($elem) => {
      $elem.contents().each((idx, child) => {
        if (child.type !== "tag") return;

        const $child = $(child);
        const tag = child.name;

        if (!tag || !this.blockTags.includes(tag)) {
          traverse($child);
          return;
        }

        let text = $child.text().replace(/\s+/g, " ").trim();

        if (!text || text.length === 0) {
          traverse($child);
          return;
        }

        if (text.length < 20 && !tag.match(/^h[1-6]$/)) {
          traverse($child);
          return;
        }

        const isHeading = /^h[1-6]$/.test(tag);
        const isListItem = tag === "li";
        const isQuote = tag === "blockquote";
        const isCaption = tag === "figcaption";

        // Detect likely visual heading
        const isLikelyVisualHeading =
          text.length <= 100 &&
          (text.toUpperCase() === text || $child.find("strong, b").length > 0) &&
          !isListItem;

        // Detect strong heading marker
        const isStrongHeading = this.strongHeadingMarkers.some((marker) =>
          text.toUpperCase().includes(marker)
        );

        const block = {
          blockIndex: blocks.length,
          tag,
          text: text.substring(0, 500),
          textLength: text.length,
          fullText: text,
          isHeading,
          isLikelyVisualHeading,
          isStrongHeading,
          isQuote,
          isListItem,
          isCaption,
          charStartApprox: charOffset,
          charEndApprox: charOffset + text.length,
        };

        blocks.push(block);
        charOffset += text.length + 1;
      });
    };

    traverse($.root());
    return blocks;
  }

  /**
   * Build semantic sections using v2 rules.
   */
  buildSections(blocks) {
    const sections = [];
    let currentSectionBlocks = [];
    let currentSectionChars = 0;
    let blocksSinceLastBoundary = 0;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const nextBlock = blocks[i + 1];

      currentSectionBlocks.push(i);
      currentSectionChars += block.textLength;
      blocksSinceLastBoundary++;

      // ===================================================================
      // V2 BOUNDARY RULES
      // ===================================================================

      let shouldBoundary = false;
      let boundaryReason = "none";

      // Rule 1: Hard boundary - Visual heading (only if section >= minChars OR strong heading)
      if (
        block.isLikelyVisualHeading &&
        (currentSectionChars >= this.config.minSectionChars || block.isStrongHeading)
      ) {
        shouldBoundary = true;
        boundaryReason = "hard_heading";
      }

      // Rule 2: Soft boundary - Topic shift (requires targetChars + new named entity)
      if (!shouldBoundary && nextBlock && currentSectionChars >= this.config.targetSectionChars) {
        const nextText = nextBlock.fullText.toLowerCase();
        const nextTextStart = nextText.substring(0, 80);

        const hasTopicShift = this.topicShiftCues.some((cue) =>
          nextTextStart.startsWith(cue.toLowerCase())
        );

        const hasNewCluster = this.namedClusters.some(
          (cluster) =>
            nextBlock.fullText.includes(cluster) &&
            !currentSectionBlocks.some((idx) => blocks[idx].fullText.includes(cluster))
        );

        if (
          hasTopicShift &&
          hasNewCluster &&
          blocksSinceLastBoundary >= this.config.boundaryHysteresis
        ) {
          shouldBoundary = true;
          boundaryReason = "soft_topic_shift";
        }
      }

      // Rule 3: Soft boundary - Hysteresis: Reject if boundary created in last N blocks
      if (shouldBoundary && boundaryReason === "soft_topic_shift" &&
          blocksSinceLastBoundary < this.config.boundaryHysteresis) {
        shouldBoundary = false;
        boundaryReason = "rejected_hysteresis";
      }

      // Rule 4: Hard boundary - Exceeds max size
      if (
        !shouldBoundary &&
        nextBlock &&
        currentSectionChars + nextBlock.textLength > this.config.maxSectionChars
      ) {
        shouldBoundary = true;
        boundaryReason = "hard_max_size";
      }

      // Rule 5: Hard boundary - Article end
      if (i === blocks.length - 1) {
        shouldBoundary = true;
        boundaryReason = "article_end";
      }

      // Rule 6: Preserve quote clusters
      if (shouldBoundary && (block.isQuote || (nextBlock && nextBlock.isQuote))) {
        if (
          currentSectionChars + (nextBlock?.textLength || 0) <= this.config.maxSectionChars
        ) {
          shouldBoundary = false;
          boundaryReason = "preserved_quote_cluster";
        }
      }

      // Rule 7: Don't create tiny heading-only sections
      if (shouldBoundary && currentSectionBlocks.length === 1 && block.isLikelyVisualHeading) {
        if (nextBlock && currentSectionChars + nextBlock.textLength <= this.config.maxSectionChars) {
          shouldBoundary = false;
          boundaryReason = "preserved_heading_with_content";
        }
      }

      if (shouldBoundary && currentSectionBlocks.length > 0) {
        // Create section
        const sectionBlockIndexes = [...currentSectionBlocks];
        const sectionText = sectionBlockIndexes.map((idx) => blocks[idx].fullText).join(" ");

        // Find heading
        const firstHeadingIdx = sectionBlockIndexes.find(
          (idx) => blocks[idx].isHeading || blocks[idx].isLikelyVisualHeading
        );
        let heading = "";
        if (firstHeadingIdx !== undefined) {
          heading = blocks[firstHeadingIdx].fullText.substring(0, 100);
        }

        // Infer label
        let inferredLabel = heading || sectionText.substring(0, 80);
        for (const cluster of this.namedClusters) {
          if (sectionText.includes(cluster)) {
            inferredLabel = cluster;
            break;
          }
        }

        const section = {
          sectionIndex: sections.length,
          heading,
          inferredLabel: inferredLabel.substring(0, 100),
          text: sectionText.substring(0, 500),
          fullText: sectionText,
          blockStart: sectionBlockIndexes[0],
          blockEnd: sectionBlockIndexes[sectionBlockIndexes.length - 1],
          blockCount: sectionBlockIndexes.length,
          charCount: sectionText.length,
          boundaryReason,
          sourceBlockIndexes: sectionBlockIndexes,
          startsWith: sectionText.substring(0, 60).replace(/\n/g, " "),
          endsWith: sectionText.substring(Math.max(0, sectionText.length - 60)).replace(/\n/g, " "),
        };

        sections.push(section);

        // Reset
        currentSectionBlocks = [];
        currentSectionChars = 0;
        blocksSinceLastBoundary = 0;

        // Add overlap for forced splits
        if (
          boundaryReason === "hard_max_size" &&
          this.config.overlapBlocksWhenForcedSplit > 0 &&
          nextBlock
        ) {
          for (let j = 0; j < this.config.overlapBlocksWhenForcedSplit && i < blocks.length - 1; j++) {
            currentSectionBlocks.push(i + 1 + j);
            currentSectionChars += blocks[i + 1 + j].textLength;
          }
        }
      }
    }

    return sections;
  }
}

export default ArticleSectioning;
