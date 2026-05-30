export interface DemandRegion {
  lat: number;
  lng: number;
  r: number;
  label: string;
  intensity: number;
}

export const NICHE_DEMAND: Record<string, DemandRegion[]> = {
  "food":        [
    { lat: 39.8283, lng:  -98.5795, r: 1_500_000, label: "North America", intensity: 90 },
    { lat: 54.5260, lng:   15.2551, r: 1_200_000, label: "Europe",        intensity: 75 },
    { lat: 20.5937, lng:   78.9629, r: 1_300_000, label: "South Asia",    intensity: 85 },
    { lat: 35.8617, lng:  104.1954, r: 1_000_000, label: "East Asia",     intensity: 70 },
  ],
  "restaurant":  [
    { lat: 39.8283, lng:  -98.5795, r: 1_500_000, label: "North America", intensity: 90 },
    { lat: 54.5260, lng:   15.2551, r: 1_200_000, label: "Europe",        intensity: 72 },
    { lat: 20.5937, lng:   78.9629, r: 1_000_000, label: "South Asia",    intensity: 80 },
  ],
  "clothing":    [
    { lat: 39.8283, lng:  -98.5795, r: 1_400_000, label: "North America", intensity: 88 },
    { lat: 54.5260, lng:   15.2551, r: 1_100_000, label: "Europe",        intensity: 85 },
    { lat: 35.8617, lng:  104.1954, r: 1_200_000, label: "East Asia",     intensity: 78 },
    { lat: -14.235, lng:  -51.9253, r:   900_000, label: "South America", intensity: 55 },
  ],
  "beauty":      [
    { lat: 39.8283, lng:  -98.5795, r: 1_300_000, label: "North America", intensity: 85 },
    { lat: 48.8566, lng:    2.3522, r:   900_000, label: "France/EU",     intensity: 90 },
    { lat: 35.6762, lng:  139.6503, r:   700_000, label: "Japan",         intensity: 80 },
    { lat: 31.2304, lng:  121.4737, r:   800_000, label: "China",         intensity: 75 },
  ],
  "fitness":     [
    { lat: 39.8283, lng:  -98.5795, r: 1_400_000, label: "North America", intensity: 92 },
    { lat: 54.5260, lng:   15.2551, r: 1_000_000, label: "Europe",        intensity: 78 },
    { lat: -25.2744, lng: 133.7751, r:   700_000, label: "Australia",     intensity: 70 },
  ],
  "healthcare":  [
    { lat: 39.8283, lng:  -98.5795, r: 1_500_000, label: "North America", intensity: 95 },
    { lat: 54.5260, lng:   15.2551, r: 1_100_000, label: "Europe",        intensity: 80 },
    { lat: 35.8617, lng:  104.1954, r: 1_000_000, label: "China",         intensity: 72 },
  ],
  "crm":         [
    { lat: 39.8283, lng:  -98.5795, r: 1_400_000, label: "North America", intensity: 95 },
    { lat: 54.5260, lng:   15.2551, r: 1_100_000, label: "Europe",        intensity: 82 },
    { lat: -25.2744, lng: 133.7751, r:   700_000, label: "Australia",     intensity: 65 },
    { lat: 1.3521,  lng:  103.8198, r:   600_000, label: "Southeast Asia",intensity: 70 },
  ],
  "saas":        [
    { lat: 37.7749, lng: -122.4194, r: 1_200_000, label: "Silicon Valley", intensity: 98 },
    { lat: 51.5074, lng:   -0.1278, r:   900_000, label: "London/EU",      intensity: 85 },
    { lat: 1.3521,  lng:  103.8198, r:   600_000, label: "Southeast Asia", intensity: 72 },
    { lat: -33.8688,lng:  151.2093, r:   600_000, label: "Australia",      intensity: 68 },
  ],
  "fintech":     [
    { lat: 39.8283, lng:  -98.5795, r: 1_300_000, label: "North America", intensity: 93 },
    { lat: 51.5074, lng:   -0.1278, r:   900_000, label: "London",        intensity: 90 },
    { lat: 1.3521,  lng:  103.8198, r:   700_000, label: "Singapore",     intensity: 88 },
    { lat: 52.3676, lng:    4.9041, r:   700_000, label: "Amsterdam",     intensity: 78 },
  ],
  "nutrition":   [
    { lat: 39.8283, lng:  -98.5795, r: 1_400_000, label: "North America", intensity: 90 },
    { lat: 54.5260, lng:   15.2551, r: 1_000_000, label: "Europe",        intensity: 74 },
    { lat: 20.5937, lng:   78.9629, r: 1_000_000, label: "South Asia",    intensity: 72 },
    { lat: -25.2744,lng:  133.7751, r:   650_000, label: "Australia",     intensity: 62 },
  ],
  "supplement":  [
    { lat: 39.8283, lng:  -98.5795, r: 1_300_000, label: "North America", intensity: 92 },
    { lat: 54.5260, lng:   15.2551, r:   900_000, label: "Europe",        intensity: 70 },
    { lat: -25.2744,lng:  133.7751, r:   600_000, label: "Australia",     intensity: 65 },
  ],
  "vitamin":     [
    { lat: 39.8283, lng:  -98.5795, r: 1_300_000, label: "North America", intensity: 91 },
    { lat: 54.5260, lng:   15.2551, r:   950_000, label: "Europe",        intensity: 73 },
    { lat: 20.5937, lng:   78.9629, r:   800_000, label: "South Asia",    intensity: 68 },
  ],
  "health":      [
    { lat: 39.8283, lng:  -98.5795, r: 1_500_000, label: "North America", intensity: 92 },
    { lat: 54.5260, lng:   15.2551, r: 1_100_000, label: "Europe",        intensity: 78 },
    { lat: 20.5937, lng:   78.9629, r:   900_000, label: "South Asia",    intensity: 70 },
  ],
  "wellness":    [
    { lat: 39.8283, lng:  -98.5795, r: 1_400_000, label: "North America", intensity: 90 },
    { lat: 54.5260, lng:   15.2551, r: 1_000_000, label: "Europe",        intensity: 78 },
    { lat: -25.2744,lng:  133.7751, r:   700_000, label: "Australia",     intensity: 68 },
  ],
  "default":     [
    { lat: 39.8283, lng:  -98.5795, r: 1_400_000, label: "North America", intensity: 85 },
    { lat: 54.5260, lng:   15.2551, r: 1_100_000, label: "Europe",        intensity: 75 },
    { lat: 20.5937, lng:   78.9629, r:   900_000, label: "South Asia",    intensity: 68 },
  ],
};

export function getDemandRegions(niche: string): DemandRegion[] {
  const n = niche.toLowerCase();
  for (const [key, regions] of Object.entries(NICHE_DEMAND)) {
    if (n.includes(key)) return regions;
  }
  return NICHE_DEMAND.default;
}
