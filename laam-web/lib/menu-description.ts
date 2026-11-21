const HASHTAG_PATTERN = /#([^#\s]+)/g;

export type MenuDescriptionParts = {
  tags: string[];
  body: string;
};

/**
 * 관리자가 메뉴 설명 첫 줄에 "#상큼함#과일향"처럼 적은 #태그를 라벨로 분리한다.
 * 태그 사이 공백 여부와 상관없이 분리하고, 같은 태그는 한 번만 남긴다.
 */
export function splitMenuDescription(description: string): MenuDescriptionParts {
  const tags: string[] = [];
  for (const match of description.matchAll(HASHTAG_PATTERN)) {
    if (!tags.includes(match[1])) {
      tags.push(match[1]);
    }
  }

  const body = description
    .replace(HASHTAG_PATTERN, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");

  return { tags, body };
}
