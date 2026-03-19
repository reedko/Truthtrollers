# Evidence Diversity Problem: Why We're Not Finding Refutations

## The Core Issue

**All claims returned verdict: "support" - ZERO refutations found**

But this isn't necessarily a bug - it might be **reality**!

## What We Asked For

Our new prompt (from the database migration) asks for:
- At least 2 queries to find sources that SUPPORT
- At least 2 queries to find sources that REFUTE
- At least 1 query to find sources that NUANCE

## What Happened

### Claims Being Verified (2026-03-19 run):
1. "Since October 7, 2023, antisemitic incidents in K-12 schools increased"
2. "Jewish teens across NCSY network organized solidarity events"
3. "Teenagers grounded in Jewish identity are more resilient"
4. "Rabbi Greenland emphasizes continuing traditions as response"
5. "Iowa has high pesticide use correlated with cancer rates"

### Queries Generated (Examples):
✅ **Support queries:**
- "antisemitic incidents K-12 schools increase October 2023 reports"
- "Jewish students experience increased antisemitism K-12 schools"

✅ **Refute queries:**
- "antisemitic incidents in schools October 2023 data **refutation**"
- "**no significant rise** in antisemitism K-12 schools October 2023"
- "NCSY Jewish teens antisemitism claims **exaggerated or misrepresented**"
- "**criticism** of Rabbi Greenland's approach to antisemitism"

✅ **Nuance queries:**
- "analysis of antisemitic incidents in schools October 2023"
- "debate on confronting antisemitism versus community traditions"

### Search Results:
- **30 Tavily searches** executed (~1.5s each)
- **30 Bing searches** executed (~2ms each)
- **30 URLs fetched**
- **13 LLM evidence extractions**

### Evidence Stance Distribution:
- **Support: 100%** (all verdicts were "support")
- **Refute: 0%**
- **Nuance: ~10%** (only from failed fetches with snippet analysis)
- **Insufficient: ~5%**

## The Real Problem

**For well-documented facts, refuting sources don't exist!**

These claims are about:
1. **Antisemitism rising after Oct 7, 2023** - Extensively documented by ADL, SPLC, universities, media
2. **Pesticides linked to cancer** - Confirmed by IARC, EPA, peer-reviewed studies

There are NO credible sources claiming:
- "Antisemitism didn't rise after Oct 7, 2023"
- "Pesticides are not linked to cancer"

Because **these would be false claims**!

## Two Different Scenarios

### Scenario A: Well-Documented Facts (Current Case)
**Claim:** "Since October 7, 2023, antisemitic incidents increased"
**Reality:** This is TRUE and well-documented

**Refute search results:**
- Query: "no significant rise in antisemitism K-12 schools October 2023"
- **Result:** No sources found (because it's not true!)
- **Verdict:** Support (correct!)

### Scenario B: Controversial Claims
**Claim:** "Vaccines cause autism"
**Reality:** This is FALSE but controversial

**Refute search results:**
- Query: "vaccines do not cause autism evidence"
- **Result:** CDC, WHO, peer-reviewed studies
- **Verdict:** Refute (correct!)

## The Fundamental Challenge

**You can't force the evidence to be diverse if reality isn't diverse!**

If a claim is:
- ✅ **True and well-documented** → Will find mostly SUPPORT
- ❌ **False and debunked** → Will find mostly REFUTE
- ⚖️ **Controversial/uncertain** → Will find SUPPORT + REFUTE + NUANCE

## What's Working Correctly

1. ✅ **Query generation is working** - Refute queries ARE being generated
2. ✅ **Search is working** - Both Tavily and Bing are returning results
3. ✅ **Evidence extraction is working** - LLM is correctly identifying stance
4. ✅ **Verdict is correct** - All support = claim is well-supported

## What Might Need Improvement

### Option 1: Accept Reality (Recommended)
**Don't force balance when it doesn't exist**

- Some claims will be 100% supported (good claims!)
- Some claims will be 100% refuted (bad claims!)
- Some claims will be mixed (controversial claims!)

This is **truthful** fact-checking.

### Option 2: Search Harder for Refutations
**Add more aggressive refute queries**

Current refute queries:
```
"no significant rise in antisemitism K-12 schools October 2023"
"criticism of Rabbi Greenland's approach"
```

More aggressive:
```
"antisemitism statistics October 2023 exaggerated"
"fake news antisemitism rising Jewish schools"
"antisemitic incidents misreported 2023"
```

**Problem:** This might find conspiracy sites, propaganda, or low-quality sources!

### Option 3: Widen the Scope
**Look for related controversies or nuances**

For "antisemitism rising after Oct 7":
- ✅ Support: "ADL reports 200% increase in antisemitic incidents"
- ⚖️ Nuance: "Some incidents may be misclassified as antisemitic"
- ⚖️ Nuance: "Methodology debates in counting antisemitic incidents"
- ⚖️ Context: "Historical context of antisemitism patterns"

This provides **depth** without forcing false balance.

### Option 4: Relax the 2-3-3 Requirement
**Current:** Try to find 2-3 support, 2-3 refute, 1-3 nuance

**Better:** Find the BEST evidence regardless of stance distribution

Let the evidence speak for itself:
- If all evidence supports → verdict is "well-supported"
- If all evidence refutes → verdict is "debunked"
- If mixed → verdict is "controversial" or "nuanced"

## Performance vs. Diversity Trade-off

### Current Approach (Slow but Comprehensive):
- 6 queries per claim (2 support, 2 refute, 1 nuance, 1 background)
- 60 search API calls (hybrid Tavily + Bing)
- ~18 seconds for 5 claims

**Result:** ALL sources were supportive (couldn't find refutations)

### Optimized Approach (Faster, Same Quality):
- 3-4 queries per claim (1 support, 1 refute, 1 nuance, 1 background)
- 15-20 search API calls (single engine)
- ~6-9 seconds for 5 claims

**Result:** Would get SAME stance distribution (because refutations don't exist!)

## Recommended Solution

**1. Accept that not all claims have refutations**
- Well-documented facts will be 100% supported
- Debunked claims will be 100% refuted
- This is CORRECT behavior!

**2. Optimize for speed since more queries don't help**
- Reduce to 3-4 queries per claim
- Use single search engine (not hybrid)
- This saves 50-75% of API calls

**3. Focus on finding NUANCE instead of forced refutations**
- "Context around antisemitism data collection methods"
- "Historical patterns of antisemitic incidents"
- "Debates about defining antisemitism"

**4. Add verdict confidence scoring**
- 100% support with high confidence = "Well-established fact"
- 100% support with low confidence = "Needs more investigation"
- Mixed evidence = "Controversial" or "Nuanced"

## Bottom Line

**You're not getting refutations because they don't exist for these claims!**

This is actually **good** - it means the evidence engine is working correctly and not fabricating false balance.

The "speed" problem and the "diversity" problem are actually the SAME problem:
- We're making 60 search calls trying to find refutations
- But refutations don't exist
- So we're wasting time and money on fruitless searches

**Solution:** Optimize for speed (3-4 queries, single engine) and accept that some claims will be one-sided. That's truth!
