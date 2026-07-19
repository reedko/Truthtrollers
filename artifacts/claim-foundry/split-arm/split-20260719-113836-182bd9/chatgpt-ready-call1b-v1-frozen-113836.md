# ChatGPT-ready CF1 Call 1B V1 — frozen 11:38 inputs

This is the closest chat-window equivalent of the API request used by the frozen replay. The API supplied the first block as a system message, the second as a user message, and enforced the final JSON Schema through Structured Outputs. A normal ChatGPT window cannot reproduce that separation or enforcement exactly.

Copy everything between `BEGIN PROMPT` and `END PROMPT` into a new ChatGPT chat.

---

BEGIN PROMPT

You are CF1's stage 1B: source and posture judge. You work ONLY from the compact
packets below — you never see the full article. For each packet you decide who the article
attributes the proposition to, whether its CONTENT supports or contradicts the thesis, and how
the article itself deploys it.

CLAIMTEXT IS IMMUTABLE. For an existing candidateId, claimText is immutable. Never negate it,
rebut it, paraphrase it into the article's position, or append the article's response. Your job
is to classify the proposition as given, not to rewrite it.

ASSERTION SOURCE. Identify the actual entity the article attributes the proposition to — a named
institution, document, study, or quoted person distinct from the article's own authors. Never
default to the article's byline (ARTICLE AUTHORS) unless the article's own voice, with no cited
source underneath it, is genuinely the only supplier of the proposition. Source identity never
determines stance or deployment: a quoted or attributed proposition may be endorsed, reported, or
rejected, and a claim from an authoritative-sounding source may still contradict the thesis.

CONTENT STANCE (contentStance) — judge the CLAIM'S CONTENT against the thesis, and nothing else.
Ignore who asserts it and how authoritative, official, or fringe the source sounds; the source
plays NO part in this field (it belongs to assertionSource and articleDeployment). Two claims with
identical content get the same contentStance no matter who states each one.

FIRST fix the thesis DIRECTION: what conclusion is the article trying to establish? A thesis may be
contrarian — it may hold that something widely accepted is actually false, or that something widely
treated as safe or effective is actually harmful or ineffective. Hold that conclusion fixed.

THEN apply ONE counterfactual to the claim's content: assume the proposition is TRUE. Does the
article's thesis become MORE credible or LESS credible?
- supports_thesis: if true, the thesis is MORE credible — its content advances the article's conclusion.
- contradicts_thesis: if true, the thesis is LESS credible — its content advances the opposite conclusion.
- neutral: its truth would not move the thesis in either direction.

Apply these on CONTENT alone:
- A claim asserting that the very matter the thesis disputes is FINE — safe, effective, sound, or
  properly done — is contradicts_thesis, because if true the article's conclusion is weaker. (For a
  thesis that a product is unsafe, the content "the product is safe and well tested" is
  contradicts_thesis — regardless of who states it.)
- A claim asserting that same matter is NOT fine — unsafe, ineffective, or improperly done — is
  supports_thesis, even when it is alarming or attacks a respected institution; that is the article's
  own case.
- A bare background or context-setting fact — a count, rate, date, or descriptive figure — whose
  truth does not itself strengthen or weaken the article's conclusion is neutral, regardless of which
  institution reported it and regardless of whether it names an entity the article criticizes.

Decide from claimText and the thesis ALONE — no rebuttal or opposing passage is required, and being
attributed to an authority the article criticizes is NEVER by itself a reason to mark contradicts_thesis.

ARTICLE DEPLOYMENT (articleDeployment) — SEPARATELY, judge how the article itself treats this
claim, using its grounding units and whatever response window / possibleResponse is available.
- endorsed: the article advances the claim as its own or affirms it.
- rebutted: the article explicitly answers, disputes, corrects, or refutes it.
- reported_neutral: the article states/quotes it without visibly endorsing or rebutting it.
contentStance and articleDeployment MAY disagree (e.g. contradicts_thesis + reported_neutral is a
common, correct combination when the article presents an opponent claim it never explicitly
rebuts). Do NOT reconcile them — emit each independently. If a packet carries a possibleResponse
(a distant passage that may be the article's answer to the claim), use it ONLY to inform
articleDeployment; it must NEVER change contentStance.

articleRole is the claim's argumentative job. Emit NO score transform and NO thesis-effect fields
— the host derives the transform deterministically from contentStance. sourceUnitIds ground the
proposition itself; responseUnitIds cite the units where the article responds to it (empty if none).

FLAGGED PACKETS (groundingSpan distant OR borderline). For a flagged packet, check not only
whether distant or borderline passages share one proposition, but whether they carry different
assertionSources. If so, treat them as separate claims even if their claimText would otherwise
look similar, and classify each source independently. Record needsSplit.split=true with a
one-sentence reason when the packet fuses separate assertions; otherwise split=false, reason=null.
You never rewrite claimText yourself — only flag it for host handling.



ARTICLE AUTHORS (identity only; do not infer posture from them): Ana Wolpin

ORIENTATION:
theme: The article critiques public health narratives surrounding vaccines, suggesting they are based on misinformation and lack of transparency.
thesis: Public health claims about vaccines are misleading and not supported by credible evidence, leading to a dangerous narrative that ignores potential vaccine-related health issues.
thesisHinge: mixed
pillars:
- Vaccine Safety (load_bearing)
- Vaccine Efficacy (load_bearing)
- Public Health Messaging (major)
- Censorship and Information Control (major)

PACKETS (compact; the full article is intentionally not included):
[{"id":"CAND01","origin":"candidate","claimText":"Half of American school children are not fully vaccinated.","sourceUnitIds":["U0002"],"groundingSpan":"clustered","claimUnits":"“According to the CDC and public health authorities, parents who choose not to vaccinate their children are typically highly educated. CDC data reflect that half of American school children are not fully vaccinated, and at least 1 in 88 toddlers are completely unvaccinated. Why would the parents of these children, comprising a large part of the nation’s brain trust, choose not to vaccinate their children?”","attributionLeadIn":null,"quoteOrSpeakerBlock":null,"localResponseWindow":"— Aaron Siri, from the foreword of “Vaccines, Amen: The Religion of Vaccines” ——————————————— “What’s the Truth about Vaccines?” asked Jefferson County Public Health (JCPH) in a quarter-page ad in the March 11 Port Townsend Leader. The hand-drawn, whimsical cartoon-style presentation and the ad’s content offered a light-hearted attempt to ease parents’ concerns about vaccinating their children. “This is a JUDGEMENT FREE guide to learn about vaccines,” the ad opens with. “You don’t need to have your mind made up to start reading. BRING YOUR CURIOSITY!” Among the statements made: • “Our kids fac…","sectionHeading":"","structuralSignals":{"blockType":"paragraph_group","unitTypes":["quotation"]}},{"id":"CAND02","origin":"candidate","claimText":"At least 1 in 88 toddlers are completely unvaccinated.","sourceUnitIds":["U0002"],"groundingSpan":"clustered","claimUnits":"“According to the CDC and public health authorities, parents who choose not to vaccinate their children are typically highly educated. CDC data reflect that half of American school children are not fully vaccinated, and at least 1 in 88 toddlers are completely unvaccinated. Why would the parents of these children, comprising a large part of the nation’s brain trust, choose not to vaccinate their children?”","attributionLeadIn":null,"quoteOrSpeakerBlock":null,"localResponseWindow":"— Aaron Siri, from the foreword of “Vaccines, Amen: The Religion of Vaccines” ——————————————— “What’s the Truth about Vaccines?” asked Jefferson County Public Health (JCPH) in a quarter-page ad in the March 11 Port Townsend Leader. The hand-drawn, whimsical cartoon-style presentation and the ad’s content offered a light-hearted attempt to ease parents’ concerns about vaccinating their children. “This is a JUDGEMENT FREE guide to learn about vaccines,” the ad opens with. “You don’t need to have your mind made up to start reading. BRING YOUR CURIOSITY!” Among the statements made: • “Our kids fac…","sectionHeading":"","structuralSignals":{"blockType":"paragraph_group","unitTypes":["quotation"]}},{"id":"CAND03","origin":"candidate","claimText":"The type of mercury in vaccines – ethylmercury – is NOT harmful to us.","sourceUnitIds":["U0297"],"groundingSpan":"clustered","claimUnits":"[2] MERCURY The type of mercury in vaccines – ethylmercury – is NOT harmful to us.","attributionLeadIn":"“If your baby weighs 7 pounds at birth (approximately 3 kilograms), the FDA stipulations suggest that the maximum safe dose for that newborn is 15 micrograms, sixteen times less than what is given in one hepatitis B vaccine. Since infants may not be able to effectively rid their bodies of aluminum,…","quoteOrSpeakerBlock":null,"localResponseWindow":"It prevents microbial growth in multi-dose vaccines. No childhood vaccines contain mercury.","sectionHeading":"Initial U.S. Approval: 1983","structuralSignals":{"blockType":"paragraph_group","unitTypes":["sentence"]}},{"id":"CAND04","origin":"candidate","claimText":"Aluminum is used in many childhood vaccines as an adjuvant to provoke an immune response.","sourceUnitIds":["U0253"],"groundingSpan":"clustered","claimUnits":"Aluminum is used in many childhood vaccines like HepB as an adjuvant, to provoke an immune response.","attributionLeadIn":"“The ATSDR [Agency for Toxic Substances and Disease Registry] oral aluminum limit is based on 0.1% of oral aluminum being absorbed into the bloodstream, as the digestive tract blocks nearly all oral aluminum (Fig. 2a). In contrast, aluminum injected intramuscularly bypasses the digestive tract, and…","quoteOrSpeakerBlock":null,"localResponseWindow":"It is known to cause brain damage at all doses. Aluminum poisoning has been linked to autism, SIDs, seizures, autoimmune issues, Alzheimers, neurological damage, impaired renal function, demyelinating disorders such as MS, and cancer. [ source ] In the mid-1900s, the FDA established a maximum limit of 850 mcg (0.85 mg) of aluminum per vaccine dose. Then, based on a 1997 study of preterm infants receiving intravenous-feeding solutions, a safe level of exposure for injectables was shown to be a small fraction of that 850 mcg. Safety limits were now set for neonates at 4-5 mcg per kilogram of bod…","sectionHeading":"THE FACTS / ALUMINUM:","structuralSignals":{"blockType":"heading_section","unitTypes":["sentence"]}},{"id":"CAND05","origin":"candidate","claimText":"The CDC has never safety tested the cumulative aluminum load received in multiple shots.","sourceUnitIds":["U0279"],"groundingSpan":"clustered","claimUnits":"The CDC has NEVER safety tested this cumulative load received in multiple shots.","attributionLeadIn":null,"quoteOrSpeakerBlock":null,"localResponseWindow":"Physicians for Informed Consent show aluminum content for the childhood vaccines: Why does the 25 mcg limit apply for other injectables but not vaccines? The mid-1900s study that determined the 850 mcg limit may present the answer to that question. The purpose of that study was not to determine safety — it was to find out the amount of aluminum needed to provoke an immune response. A 1947 document related to the manufacture of diphtheria toxoid states, “In all instances, the amount of aluminum used shall be the minimum needed to accomplish the purpose intended.” In “ Reconsideration of the imm…","sectionHeading":"RECOMBIVAX HB® Hepatitis B Vaccine (Recombinant)\n\nSuspension for intramuscular injection\n\nInitial U.S. Approval: 1983","structuralSignals":{"blockType":"heading_section","unitTypes":["sentence"]}},{"id":"CAND06","origin":"candidate","claimText":"SIDS became the leading cause of infant mortality following the introduction of national vaccination programs in the U.S.","sourceUnitIds":["U0198"],"groundingSpan":"clustered","claimUnits":"As Neil Z.","attributionLeadIn":null,"quoteOrSpeakerBlock":null,"localResponseWindow":"Miller observes above, following the introduction of national vaccination programs in the U.S., SIDS became the leading cause of infant mortality. Like other dangers associated with vaccination, health authorities sought to explain away this new phenomenon. In his 2021 report “Vaccines and sudden infant death: An analysis of the VAERS database 1990–2019 and review of the medical literature,” Miller explains: “Throughout the 1980s, sudden infant deaths continued to skyrocket. Parental concerns about an apparent link between childhood vaccines and SIDS reached a fever pitch. Many parents were af…","sectionHeading":"THE FACTS:","structuralSignals":{"blockType":"heading_section","unitTypes":["sentence"]}},{"id":"CAND07","origin":"candidate","claimText":"The CDC manipulated data to disprove a link between MMR vaccines and autism.","sourceUnitIds":["U0041"],"groundingSpan":"clustered","claimUnits":"The fraudulent, re-worked study was then released to declare that it had proven MMR vaccines did not cause autism.","attributionLeadIn":null,"quoteOrSpeakerBlock":null,"localResponseWindow":"Believing the order to destroy data was illegal, Thompson secretly saved over 10,000 pages of documents. He would reveal them a decade later, conscience-stricken over the likely damage in ongoing vaccine injury the cover-up was causing. The CDC had conducted the study in response to petitions from over 5,000 parents in vaccine court who had witnessed their children regress into autism from the MMR shot. When the fraudulent “results” were released, those petitions were dismissed with the stroke of a pen. The CDC announced: No more research money will be spent on this question; “the science is s…","sectionHeading":"Three Distinct Attitudes About Vaccination","structuralSignals":{"blockType":"paragraph_group","unitTypes":["sentence"]}},{"id":"CAND08","origin":"candidate","claimText":"Thimerosal is toxic and has been linked to neurological damage.","sourceUnitIds":["U0308"],"groundingSpan":"clustered","claimUnits":"Mercury is the third most toxic element on earth, 500 times more poisonous than lead.","attributionLeadIn":"“Forbidden Facts: Government Deceit & Suppression About Brain Damage from Childhood Vaccines”","quoteOrSpeakerBlock":null,"localResponseWindow":"Thimerosal is the trade name for the 50% ethylmercury solution used since the 1930s as a preservative in vaccines. Contrary to our health department’s claim, it is highly neurotoxic — dangerous enough to cause “decreased offspring survival” as Eli Lilly was required by law to disclose in its Material Safety Data Sheet for thimerosal. New works have expanded on Robert F. Kennedy, Jr’s 2015 book on thimerosal mentioned earlier, not least the unexpected perspective of internationally recognized criminologist Gavin de Becker, quoted above. More than a review of the scientific literature, his best-…","sectionHeading":"THE FACTS / MERCURY:","structuralSignals":{"blockType":"heading_section","unitTypes":["sentence"]}},{"id":"CAND09","origin":"candidate","claimText":"The CDC's claim that thimerosal is not harmful is contradicted by its classification as toxic hazardous waste.","sourceUnitIds":["U0367"],"groundingSpan":"clustered","claimUnits":"The claim by health agencies that injected ethylmercury is benign becomes even more inconceivable in light of the fact that the EPA classifies the thimerosal in vaccines as toxic hazardous waste .","attributionLeadIn":"He further notes that studies that denied a risk were nearly always generated by the groups promoting vaccination, rarely by independent researchers.","quoteOrSpeakerBlock":null,"localResponseWindow":"The limit for mercury in drinking water is set at 200 parts per billion per the EPA’s Toxicity Characteristic Leaching Procedure (TCLP). The mercury in multi-dose flu shots preserved with thimerosal, injected directly into the body, is 250 times higher— 50,000 parts per billion. Thimerosal as a Vaccine Preservative , a summary prepared in 2025 for the CDC’s Advisory Committee for Immunization Practices (ACIP), notes that “thimerosal-containing vaccines exceed the TCLP threshold by orders of magnitude and are classified as D009 Hazardous Waste.” PharmEcology’s Disposal Guidelines for the 2025-2…","sectionHeading":"","structuralSignals":{"blockType":"paragraph_group","unitTypes":["sentence"]}},{"id":"CAND10","origin":"candidate","claimText":"The DTaP vaccine contains aluminum, formaldehyde, and polysorbate 80.","sourceUnitIds":["U0392"],"groundingSpan":"clustered","claimUnits":"From the 16-page package insert of Infanrix, a DTaP vaccine “indicated for active immunization against diphtheria, tetanus, and pertussis as a 5-dose series in infants and children aged 6 weeks through 6 years”:","attributionLeadIn":null,"quoteOrSpeakerBlock":null,"localResponseWindow":"Along with other chemicals, DTaP formulations contain aluminum, formaldehyde and polysorbate 80. The polysorbate 80 helps deliver the aluminum into the brain and other organs; the formaldehyde has the potential to damage the liver and kidneys, as well as cause cancer. Depending on the manufacturer, the DTaP shot may also include bovine extract, monkey kidney tissue (suspected to contain SV-40, a cancer-causing virus), and neomycin sulfate or polymyxin B, both antibiotics. At the core of the vaccine narrative, the notion that a vaccine only contains a small amount of virus, bacteria or other an…","sectionHeading":"","structuralSignals":{"blockType":"paragraph_group","unitTypes":["sentence"]}},{"id":"CAND11","origin":"candidate","claimText":"The CDC partnered with pharma as the primary purchaser, distributor, and promoter of billions of dollars of vaccines annually.","sourceUnitIds":["U0077"],"groundingSpan":"clustered","claimUnits":"The CDC partnered with pharma as the primary purchaser, distributor and promoter of billions of dollars of vaccines annually.","attributionLeadIn":"Each new childhood shot approved was automatically added to the CDC’s Childhood Vaccine Schedule, with the assurance that tens of millions of children would receive them at routine pediatric visits.","quoteOrSpeakerBlock":null,"localResponseWindow":"A more-is-better free-for-all ensued. While children had received just five vaccine doses in three shots in the 1950s and ’60s when I was growing up (none during pregnancy or in the first 12 months of life), by 1986 children were receiving 25 doses/12 shots. In the decades following the 1986 act the childhood schedule exploded to 73 doses/54 shots. New vaccines were developed for illnesses like hepatitis B and rotavirus, for which there was little risk and which effectively had 100% survival rates for healthy American children. Mild illnesses which formerly helped strengthen developing infants…","sectionHeading":"People Who Do the Research","structuralSignals":{"blockType":"heading_section","unitTypes":["sentence"]}},{"id":"CAND12","origin":"candidate","claimText":"The childhood vaccination schedule has increased from 5 doses in the 1950s to 73 doses by 2016.","sourceUnitIds":["U0080"],"groundingSpan":"clustered","claimUnits":"In the decades following the 1986 act the childhood schedule exploded to 73 doses/54 shots.","attributionLeadIn":"Each new childhood shot approved was automatically added to the CDC’s Childhood Vaccine Schedule, with the assurance that tens of millions of children would receive them at routine pediatric visits.","quoteOrSpeakerBlock":null,"localResponseWindow":"New vaccines were developed for illnesses like hepatitis B and rotavirus, for which there was little risk and which effectively had 100% survival rates for healthy American children. Mild illnesses which formerly helped strengthen developing infants’ and children’s immune systems were now vaccinated against, all fodder for pharma’s liability-free cash cow. Pregnant mothers were injected, infants started receiving shots on their first day of life, and the practice of administering multiple shots — as many as ten doses in eight shots at one time (never tested in combination) in a euphemistically…","sectionHeading":"People Who Do the Research","structuralSignals":{"blockType":"heading_section","unitTypes":["sentence"]}},{"id":"CAND13","origin":"candidate","claimText":"The rise in chronic illnesses among children correlates with the increase in vaccination rates.","sourceUnitIds":["U0096"],"groundingSpan":"clustered","claimUnits":"Did correlation equal causation?","attributionLeadIn":null,"quoteOrSpeakerBlock":null,"localResponseWindow":"Following the release of the film Vaxxed , parents came out of the woodwork wanting to share their stories of vaccine injury. The Vaxxed bus was born. Traveling to every U.S. state on the continent, its dedicated team video-taped thousands of stories of vaccine injury and death. More than 8,000 names were signed on the bus’ exterior of adults and children injured or killed by vaccines. The common themes in stories parents recounted were eerie. Many described rushing their infants or toddlers to the ER with convulsions, 105° fevers, horrifying screams and seizures after their shots, only to be…","sectionHeading":"People Who Do the Research","structuralSignals":{"blockType":"paragraph_group","unitTypes":["sentence"]}},{"id":"CAND14","origin":"candidate","claimText":"The CDC announced that no more research money would be spent on the question of vaccines causing autism, claiming 'the science is settled.'","sourceUnitIds":["U0046"],"groundingSpan":"clustered","claimUnits":"The CDC announced: No more research money will be spent on this question; “the science is settled.”","attributionLeadIn":null,"quoteOrSpeakerBlock":null,"localResponseWindow":"This fraud was the subject of the shocking and controversial movie Vaxxed: From Cover-Up to Catastrophe. Scheduled to premier at the Tribeca Film Festival, Big Pharma pressure forced its cancellation. The effort to suppress the film only gave it more publicity and heightened public interest. Screenings across the country opened a floodgate. A tsunami of parents started speaking out about their own children’s vaccine injuries. Working with the film’s distributor and Rose Theatre owner Rocky Friedman, Annette Huenke (now a PTFP co-editor) set up a screening of Vaxxed in Port Townsend.","sectionHeading":"Three Distinct Attitudes About Vaccination","structuralSignals":{"blockType":"paragraph_group","unitTypes":["sentence"]}},{"id":"CAND15","origin":"candidate","claimText":"The health department's ad claims that vaccines are tested more than any other medicine.","sourceUnitIds":["U0012"],"groundingSpan":"clustered","claimUnits":"• “Vaccines are tested more than any other medicine you could give your kid.”","attributionLeadIn":"“This is a JUDGEMENT FREE guide to learn about vaccines,” the ad opens with. “You don’t need to have your mind made up to start reading. BRING YOUR CURIOSITY!”","quoteOrSpeakerBlock":null,"localResponseWindow":"The health department’s ad comes at a time when childhood vaccination rates are dropping steadily across the country. Along with reduction in vaccine uptake, there is also a rise in the rate of parents seeking vaccine exemptions for their children. In Part 1 of this article, we will explore the growing awareness causing this shift, share some local history on attempts to open up the conversation about vaccines in our community, and examine some of the statements above that our health department has made to reassure parents that they needn’t worry about common vaccination concerns.","sectionHeading":"","structuralSignals":{"blockType":"list","unitTypes":["list_item"]}},{"id":"CAND16","origin":"candidate","claimText":"The health department's ad states that there have been no credible studies linking vaccination to chronic disease.","sourceUnitIds":["U0011"],"groundingSpan":"clustered","claimUnits":"• “So far, there have been no credible studies that link vaccination to chronic disease.”","attributionLeadIn":"“This is a JUDGEMENT FREE guide to learn about vaccines,” the ad opens with. “You don’t need to have your mind made up to start reading. BRING YOUR CURIOSITY!”","quoteOrSpeakerBlock":null,"localResponseWindow":"• “Vaccines are tested more than any other medicine you could give your kid.” The health department’s ad comes at a time when childhood vaccination rates are dropping steadily across the country. Along with reduction in vaccine uptake, there is also a rise in the rate of parents seeking vaccine exemptions for their children. In Part 1 of this article, we will explore the growing awareness causing this shift, share some local history on attempts to open up the conversation about vaccines in our community, and examine some of the statements above that our health department has made to reassure p…","sectionHeading":"","structuralSignals":{"blockType":"list","unitTypes":["list_item"]}}]

OUTPUT REQUIREMENTS
Return JSON only, with no Markdown or commentary. Return exactly one candidateJudgment for every packet candidateId, in the same order, and satisfy this schema:

{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "candidateJudgments"
  ],
  "properties": {
    "candidateJudgments": {
      "type": "array",
      "maxItems": 30,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "candidateId",
          "assertionSource",
          "contentStance",
          "articleDeployment",
          "articleRole",
          "sourceUnitIds",
          "responseUnitIds",
          "needsSplit"
        ],
        "properties": {
          "candidateId": {
            "type": "string",
            "pattern": "^CAND\\d{2}$"
          },
          "assertionSource": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300
          },
          "contentStance": {
            "type": "string",
            "enum": [
              "supports_thesis",
              "contradicts_thesis",
              "neutral"
            ]
          },
          "articleDeployment": {
            "type": "string",
            "enum": [
              "endorsed",
              "rebutted",
              "reported_neutral"
            ]
          },
          "articleRole": {
            "type": "string",
            "enum": [
              "thesis",
              "pillar",
              "pillar_support",
              "opponent_claim",
              "qualification",
              "consistency_hinge"
            ]
          },
          "sourceUnitIds": {
            "type": "array",
            "maxItems": 12,
            "items": {
              "type": "string",
              "pattern": "^U\\d{4}$"
            }
          },
          "responseUnitIds": {
            "type": "array",
            "maxItems": 12,
            "items": {
              "type": "string",
              "pattern": "^U\\d{4}$"
            }
          },
          "needsSplit": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "split",
              "reason"
            ],
            "properties": {
              "split": {
                "type": "boolean"
              },
              "reason": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 200
              }
            }
          }
        }
      }
    }
  }
}

END PROMPT
