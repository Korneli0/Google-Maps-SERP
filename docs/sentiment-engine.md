# Sentiment Engine

> `src/lib/sentimentEngine.ts` — 5-layer hybrid sentiment analysis engine combining phrase detection, word lexicons, contextual modifiers, rating integration, and aspect extraction.

Based on VADER (Hutto & Gilbert, 2014) and aspect-based sentiment analysis (Pontiki et al., 2016).

## Entry Point

```typescript
export function analyzeSentiment(
    text: string | undefined,
    rating?: number
): SentimentResult
```

### SentimentResult

```typescript
interface SentimentResult {
    score: number;        // -5 to +5 (clamped raw score)
    compound: number;     // -1 to +1 (VADER-style normalized)
    label: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';
    confidence: number;   // 0-1
    positiveWords: string[];   // up to 10
    negativeWords: string[];   // up to 10
    emotion: string;
    aspects: { aspect: string; sentiment: string; score: number }[];
}
```

## No-Text Handling

When text is empty/undefined but rating is provided:
- Score: `(rating - 3) × 1.5` → 1★=-3, 2★=-1.5, 3★=0, 4★=1.5, 5★=3
- Label: 4-5★=POSITIVE, 1-2★=NEGATIVE, 3★=NEUTRAL
- Confidence: 0.3 (low, rating-only signal)

When both text and rating are missing: all zeros, NEUTRAL.

## 5-Layer Architecture

### Layer 1: Negative Phrase Detection

48 multi-word phrases that basic lexicons miss. Checked first (highest priority).

| Category | Examples | Score |
|----------|----------|-------|
| Critical | "bait and switch", "waste of money", "rip off" | -3 to -4 |
| Legal | "called the police", "filed a complaint", "discrimination" | -3 to -5 |
| Health/Safety | "food poisoning", "health hazard", "unsafe" | -4 to -5 |
| Decision | "never again", "never going back", "stay away" | -3 to -4 |
| Fraud | "scam", "fraud", "con artist", "dishonest" | -4 to -5 |
| Pricing | "price gouging", "highway robbery" | -4 |
| Disappointment | "very disappointed", "not impressed", "overrated" | -2 to -4 |
| Deception | "misleading", "false advertising", "lied" | -3 to -4 |
| Neglect | "ignored me", "couldn't care less", "walked out" | -2 to -3 |

All phrases checked via `lower.includes(phrase)`.

### Layer 2: Positive Phrase Detection

20+ multi-word endorsements.

| Category | Examples | Score |
|----------|----------|-------|
| Endorsement | "highly recommend", "can't recommend enough" | +4 to +5 |
| Superlative | "world-class", "truly exceptional", "life-changing" | +4 to +5 |
| Exceeding | "above and beyond", "exceeded expectations", "blown away" | +3 to +4 |
| Value | "worth every penny", "great value", "fair price" | +2 to +4 |
| Quality | "very professional", "attention to detail", "went the extra mile" | +3 to +4 |
| Return intent | "look forward to", "coming back", "must visit" | +2 to +3 |

### Layer 3: Word-Level Scoring

80+ AFINN-inspired word scores. Text is cleaned: `/[^a-z'\s-]/g` removed, split by whitespace, tokens > 1 char.

| Range | Examples |
|-------|---------|
| -4 | terrible, horrible, awful, dreadful, atrocious, disgusting, worst |
| -3 | hate, pathetic, rude, disrespectful, unacceptable |
| -2 | bad, poor, disappointing, frustrating, dirty, overpriced |
| -1 | slow, cold, expensive |
| -0.5 | okay, ok, meh, average |
| +0.5 | fine, alright, adequate |
| +1 | good, nice, decent, pleasant, clean, fresh |
| +2 | great, impressive, friendly, helpful, professional, delicious |
| +3 | excellent, wonderful, fantastic, amazing, outstanding, love, perfect |
| +4 | extraordinary, flawless, impeccable |

### Layer 4: Contextual Modifiers

Applied to each scored word based on surrounding context.

#### Negators

Flip sentiment within a 3-word window before the scored word. Multiplier: `×-0.8`.

```
not, no, never, neither, nor, nobody, nothing, nowhere, hardly, barely,
scarcely, n't, don't, doesn't, didn't, wasn't, weren't, won't, wouldn't,
shouldn't, can't, cannot, without
```

Example: "not good" → `1 × -0.8 = -0.8`

#### Intensifiers

Boost magnitude of the immediately following scored word.

| Word | Multiplier |
|------|-----------|
| extremely, incredibly | ×1.5 |
| absolutely, utterly | ×1.4 |
| very, really, totally, completely, remarkably, super | ×1.3 |
| especially, particularly | ×1.2 |
| quite, so, such | ×1.1-1.2 |

Example: "extremely terrible" → `-4 × 1.5 = -6`

#### Diminishers

Reduce magnitude of the immediately following scored word.

| Word | Multiplier |
|------|-----------|
| barely, hardly | ×0.4 |
| slightly, a_little | ×0.5 |
| somewhat, a_bit | ×0.6 |
| kind, sort, rather | ×0.7 |
| almost, nearly, fairly | ×0.7-0.8 |

Example: "somewhat good" → `1 × 0.6 = 0.6`

### Punctuation & Capitalization (VADER-inspired)

- **Exclamation marks** (1-3): boost in direction of current score (+0.3 if positive, -0.2 if negative per `!`)
- **ALL CAPS words** (> 2 chars, not entire text): +0.5 or -0.5 in direction of current score

### Layer 5: Rating Integration

When a star rating is provided alongside text:

```
ratingSignal = (rating - 3) × 0.8
```

Blending rules:

| Condition | Formula | Rationale |
|-----------|---------|-----------|
| Text and rating conflict | `text × 0.4 + rating × 0.6` | Rating wins |
| Text is ambiguous (\|score\| < 0.5) | `score += rating × 0.7` | Lean on rating |
| Both agree | `score += rating × 0.3` | Minor boost |

## Normalization

### Compound Score (VADER-style)

```
compound = score / √(score² + 15)
```

Maps any raw score to [-1, +1]. The constant 15 controls the curve sensitivity.

### Label Assignment

| Condition | Label |
|-----------|-------|
| compound ≥ 0.05 | POSITIVE |
| compound ≤ -0.05 | NEGATIVE |
| positive AND negative words detected | MIXED |
| otherwise | NEUTRAL |

**Override rules:**
- Rating 1-2★ + NEUTRAL label → forced NEGATIVE
- Rating 1★ + any non-NEGATIVE label → forced NEGATIVE

### Confidence

```
confidence = min(1, wordEvidence × 0.15 + (hasRating ? 0.3 : 0))
```

Where `wordEvidence = positiveWords.length + negativeWords.length`.

## Emotion Detection

`detectEmotionAdvanced(text, label, rating)` — keyword-based detection across 10 emotions.

| Emotion | Example Keywords |
|---------|-----------------|
| Anger | angry, furious, outraged, livid, disgusted, unacceptable |
| Frustration | frustrated, annoying, waited, slow, wasted, useless |
| Disappointment | disappointed, letdown, expected better, underwhelming |
| Fear/Concern | unsafe, dangerous, worried, alarming, beware |
| Sadness | sad, heartbroken, devastated, unfortunately, regret |
| Joy | amazing, wonderful, love, awesome, thrilled, ecstatic |
| Gratitude | thank, grateful, appreciate, thankful, blessed |
| Trust | reliable, professional, trustworthy, honest, dependable |
| Surprise | surprised, unexpected, shocked, blown away, astonished |
| Contempt | scam, fraud, crook, liar, pathetic, laughable |

Selects emotion with most keyword matches. Falls back to:
- `Satisfaction` if rating ≥ 4
- `Dissatisfaction` if rating ≤ 2
- `Neutral` otherwise

## Aspect-Based Sentiment

`extractAspects(text)` — identifies and scores 8 business aspects.

| Aspect | Keywords |
|--------|----------|
| Service | service, staff, employee, team, crew, server, waiter, manager, receptionist |
| Food/Product | food, meal, dish, menu, taste, flavor, product, item, quality |
| Price | price, cost, expensive, cheap, affordable, value, worth, overpriced |
| Cleanliness | clean, dirty, filthy, hygiene, sanitary, spotless, tidy, messy |
| Atmosphere | atmosphere, ambiance, vibe, decor, music, lighting, cozy, comfortable |
| Wait Time | wait, waited, slow, fast, quick, prompt, delay, hour, minutes |
| Location | location, parking, accessible, convenient, easy to find |
| Communication | communication, response, call, email, phone, contact, follow up |

For each detected aspect:
1. Find keyword position in text
2. Extract 40-character context window around keyword
3. Score context via `quickScore()` (phrase + word lexicon)
4. Average across all found keywords for that aspect
5. Label: > 0.3 = positive, < -0.3 = negative, else neutral

## Readability

`computeReadability(text)` — returns Flesch-Kincaid grade level.

```
FK = 0.39 × avgSentenceLength + 11.8 × avgSyllablesPerWord - 15.59
```

Syllable counting uses phonetic estimation: strip silent-e endings, count vowel groups.
