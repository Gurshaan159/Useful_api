import { ReliabilityGrade } from "../domain/situation";

export function getReliabilityGrade(startsMatched: number): ReliabilityGrade {
  if (startsMatched >= 50) {
    return "A";
  }
  if (startsMatched >= 20) {
    return "B";
  }
  if (startsMatched >= 5) {
    return "C";
  }
  return "D";
}
