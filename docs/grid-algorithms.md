# Grid Algorithms

> `src/lib/grid.ts` — Generates arrays of geo-coordinates for scanning. Four algorithms with different spatial distribution patterns.

## Common Types

```typescript
interface GridPoint {
    lat: number;
    lng: number;
    id?: string;   // e.g., "sq-2-3", "circle-1-4", "smart-center"
}

type GridShape = 'SQUARE' | 'CIRCLE' | 'ZIP' | 'SMART';
```

## Entry Point

```typescript
export function generateGrid(
    centerLat: number,
    centerLng: number,
    radiusKm: number,
    gridSize: number,         // NxN for SQUARE; ring count basis for CIRCLE
    shape: GridShape = 'SQUARE'
): GridPoint[]
```

Routes to shape-specific generator. SMART ignores `gridSize` (self-adaptive).

## Shared Math

All algorithms use the same approximation for converting km to degrees:

```
1° latitude  ≈ 111.111 km  (constant everywhere)
1° longitude ≈ 111.111 × cos(latitude) km  (shrinks toward poles)
```

Formulas:
```
latDelta = radiusKm / 111.111
lngDelta = radiusKm / (111.111 × cos(centerLat × π/180))
```

This is a flat-Earth approximation (Haversine-ish) adequate for the typical scan radius (1-50 km).

---

## SQUARE

Regular NxN grid across a bounding box centered on the target.

### Algorithm

```
startLat = centerLat - latDelta
startLng = centerLng - lngDelta

latStep = (latDelta × 2) / (gridSize - 1)    // 0 if gridSize=1
lngStep = (lngDelta × 2) / (gridSize - 1)

for i in 0..gridSize-1:
    for j in 0..gridSize-1:
        point = (startLat + i × latStep, startLng + j × lngStep)
        id = "sq-{i}-{j}"
```

### Properties

- Total points: `gridSize²`
- Coverage: uniform across rectangular bounding box
- Center point included only when gridSize is odd
- Points at exact boundary edges

### Visual (5×5 example)

```
·  ·  ·  ·  ·
·  ·  ·  ·  ·
·  ·  ✕  ·  ·     ✕ = center
·  ·  ·  ·  ·
·  ·  ·  ·  ·
```

### Use Case

Best for general-purpose scanning where uniform coverage matters. Default shape.

---

## CIRCLE

Concentric hexagonal rings around center point.

### Algorithm

```
points = [center]
rings = floor(gridSize / 2)

for r in 1..rings:
    ringRadius = (radiusKm × r) / rings
    numPoints = r × 6                         // hexagonal distribution

    for i in 0..numPoints-1:
        angle = (i × 360) / numPoints         // degrees
        bearing = angle × (π / 180)           // radians

        latOffset = (ringRadius / 111.111) × cos(bearing)
        lngOffset = (ringRadius / (111.111 × cos(centerLat × π/180))) × sin(bearing)

        point = (centerLat + latOffset, centerLng + lngOffset)
        id = "circle-{r}-{i}"
```

### Properties

- Total points: `1 + Σ(r×6) for r=1..rings` = `1 + 6 × rings × (rings+1) / 2`
- Ring 1: 6 points, Ring 2: 12 points, Ring 3: 18 points, ...
- Center always included
- More points near center (denser inner rings)

### Visual (gridSize=5, 2 rings)

```
         ·   ·
       ·       ·
      ·  · · ·  ·
       ·   ✕   ·        ✕ = center
      ·  · · ·  ·
       ·       ·
         ·   ·
```

### Point Count Examples

| gridSize | Rings | Total Points |
|----------|-------|-------------|
| 3 | 1 | 7 |
| 5 | 2 | 19 |
| 7 | 3 | 37 |
| 9 | 4 | 61 |
| 11 | 5 | 91 |
| 13 | 6 | 127 |

### Use Case

Best for radial coverage from a central business location. Mimics how local search relevance decays with distance.

---

## ZIP

Four-sector clustering with random jitter. Simulates zip code boundaries without real boundary data.

### Algorithm

```
sectors = 4
pointsPerSector = ceil(gridSize² / sectors)

for s in 0..3:
    sectorAngle = (s × 360) / 4          // 0°, 90°, 180°, 270°
    bearing = sectorAngle × (π / 180)

    // Sector center at 60% of radius from center
    sLat = centerLat + (radiusKm × 0.6 / 111.111) × cos(bearing)
    sLng = centerLng + (radiusKm × 0.6 / (111.111 × cos(...))) × sin(bearing)

    for i in 0..pointsPerSector-1:
        jitter = 0.2 × radiusKm
        jLat = (random() - 0.5) × jitter / 111.111
        jLng = (random() - 0.5) × jitter / (111.111 × cos(sLat × π/180))

        point = (sLat + jLat, sLng + jLng)
        id = "zip-{s}-{i}"
```

### Properties

- Total points: `4 × ceil(gridSize²/4)`
- Non-deterministic (random jitter)
- 4 clusters at 60% of radius from center
- Each cluster has ±20% radius scatter
- No center point

### Visual (conceptual)

```
        ○○○
        ○○
                    ○○
                    ○○○
    ✕

  ○○○                ○○
  ○○                 ○○○
```

### Use Case

Intended for when scan targets align with administrative boundaries. Note: this is a stub implementation (no real ZIP/postal API integration).

---

## SMART

Adaptive concentric rings that scale spacing based on distance from center. Dense near center, sparse at edges.

### Algorithm

```
points = [center]

ringConfigs = [
    { dist: 0.15, spacing: 0.3 },    // Very tight near center
    { dist: 0.4,  spacing: 0.5 },
    { dist: 0.8,  spacing: 0.8 },
    { dist: 1.5,  spacing: 1.2 },
    { dist: 3.0,  spacing: 2.0 },
    { dist: 6.0,  spacing: 4.0 },
    { dist: 12.0, spacing: 8.0 },    // Loose at edges
]

for each ring (skip if actualDist > radiusKm AND not first 2 rings):
    actualDist = ring.dist × (radiusKm / 3)
    actualSpacing = ring.spacing × (radiusKm / 3)

    circumference = 2π × actualDist
    numPoints = max(3, floor(circumference / actualSpacing))
    angleStep = 2π / numPoints

    for i in 0..numPoints-1:
        angle = angleStep × i
        latOffset = (actualDist / 111.111) × cos(angle)
        lngOffset = (actualDist / (111.111 × cos(centerLat × π/180))) × sin(angle)

        point = (centerLat + latOffset, centerLng + lngOffset)
        id = "smart-{ringIdx}-{i}"
```

### Ring Scaling

All distances and spacings are scaled by `radiusKm / 3`. The base configs assume a 3km radius.

| Ring | Base Dist | Base Spacing | At 3km | At 5km | At 10km |
|------|-----------|-------------|--------|--------|---------|
| 0 | 0.15 | 0.3 | 0.15km | 0.25km | 0.5km |
| 1 | 0.4 | 0.5 | 0.4km | 0.67km | 1.33km |
| 2 | 0.8 | 0.8 | 0.8km | 1.33km | 2.67km |
| 3 | 1.5 | 1.2 | 1.5km | 2.5km | 5.0km |
| 4 | 3.0 | 2.0 | 3.0km | 5.0km | 10.0km |
| 5 | 6.0 | 4.0 | 6.0km (skipped) | 10.0km (skipped) | 20.0km (skipped) |
| 6 | 12.0 | 8.0 | 12.0km (skipped) | 20.0km (skipped) | 40.0km (skipped) |

Rings are skipped when `actualDist > radiusKm` (after the first 2 rings).

### Properties

- Ignores `gridSize` parameter entirely
- Point count adapts to radius
- Each ring has `max(3, floor(circumference / spacing))` points
- Minimum 3 points per ring (triangle)
- Approximately 20-40 points for typical radii

### Use Case

Best for realistic local SEO analysis. Concentrates detail where it matters most (near the business) while still providing coverage at the edges of the service area.

---

## Comparison

| Property | SQUARE | CIRCLE | ZIP | SMART |
|----------|--------|--------|-----|-------|
| Deterministic | Yes | Yes | No (random) | Yes |
| Center included | If gridSize odd | Always | No | Always |
| Uses gridSize | Yes (NxN) | Yes (rings) | Yes (total) | No |
| Coverage pattern | Uniform grid | Radial rings | 4 clusters | Adaptive rings |
| Point distribution | Even | Dense near center | Clustered | Dense center, sparse edge |
| Best for | General | Radial | Boundaries (stub) | Realistic SEO |
