export type EvidenceSource = {
  label: string;
  url: string;
};

export type EvidenceGroundedStory = {
  id: string;
  title: string;
  story: string;
  designResponse: string;
  sources: EvidenceSource[];
};

export const evidenceGroundedStories: EvidenceGroundedStory[] = [
  {
    id: "transfer-side",
    title: "Protect my transfer side",
    story:
      "As a wheelchair user who transfers into bed, I need the planner to preserve the side I use and keep the bed stable—not merely clear a corridor.",
    designResponse:
      "HomeWheel renders and validates an explicit transfer zone, refuses to move stability-critical furniture, and rejects proposals that violate either constraint.",
    sources: [
      {
        label: "United Spinal: Kelly’s accessible studio",
        url: "https://unitedspinal.org/accessibility-ideas-studio-apartment/",
      },
      {
        label: "Wheelchair transfer usability study",
        url: "https://pubmed.ncbi.nlm.nih.gov/25986519/",
      },
    ],
  },
  {
    id: "personal-geometry",
    title: "Use my actual movement",
    story:
      "As a wheelchair user with my own chair and transfer technique, I need the plan to use my dimensions and preferences instead of assuming one standard body or device.",
    designResponse:
      "The movement envelope is personal: device width, preferred passage, turning diameter, destination purpose, approach side, and clearance depth all change the simulation.",
    sources: [
      {
        label: "Wheelchair transfer usability study",
        url: "https://pubmed.ncbi.nlm.nih.gov/25986519/",
      },
      {
        label: "Qualitative study of home usability",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10792724/",
      },
    ],
  },
  {
    id: "independence",
    title: "Let me define what better means",
    story:
      "As someone adapting my home, I need to decide whether a layout supports independence, safety, reach, light, and daily routines—not have software optimize dimensions alone.",
    designResponse:
      "Personal priorities become WebMCP state. The agent previews measurable trade-offs, while the person can accept, reject, or teach it a lived constraint for the revision.",
    sources: [
      {
        label: "Qualitative study of home usability",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10792724/",
      },
      {
        label: "United Spinal: real apartment adaptations",
        url: "https://unitedspinal.org/accessibility-ideas-studio-apartment/",
      },
    ],
  },
];
