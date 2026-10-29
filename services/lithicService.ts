import { ImageAsset } from "../types";

/**
 * Utility to convert hierarchical markdown into Lithic/Monolith (.lith) format.
 * Metadata format: key: value
 * Mandatory: title, created, modified, stream-type: default
 * Streams: parent, stream-list
 * Timestamp format: YYYYMMDDHHMMSS000
 */

export const getLithicTimestamp = (date: Date = new Date()): string => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}000`;
};

interface Tiddler {
  title: string;
  streamType: string;
  parent?: string;
  streamList?: string[];
  body: string;
  prev?: string;
  next?: string;
  tags?: string;
}

export const parseMarkdownToLithic = (markdown: string, rootTitle: string = 'Imported_Content', assets: ImageAsset[] = [], prefix: string = ''): string => {
  const lines = markdown.split('\n');
  const tiddlers: Tiddler[] = [];
  const seenTitles = new Set<string>();

  const getUniqueTitle = (baseTitle: string, isNode: boolean = false): string => {
    let title = (baseTitle.trim() || 'Untitled_Node').replace(/\s+/g, '_');
    let counter = 1;
    let uniqueTitle = title;
    while (seenTitles.has(uniqueTitle)) {
      uniqueTitle = `${title}_(${counter})`;
      counter++;
    }
    seenTitles.add(uniqueTitle);
    return uniqueTitle;
  };

  const formatTitleWithPrefix = (titleText: string): string => {
    const cleanTitle = titleText.trim().replace(/\s+/g, '_');
    const cleanPrefix = prefix ? prefix.trim().replace(/\s+/g, '_') : '';
    return cleanPrefix ? `${cleanPrefix}_${cleanTitle}` : cleanTitle;
  };

  let currentChapter: Tiddler | null = null;
  let currentPage: Tiddler | null = null;
  let globalParagraphCount = 1;
  
  // Track consecutive chapters for prev/next linking
  const chapters: Tiddler[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);
    const h3Match = line.match(/^###\s+(.+)$/);

    if (h1Match) {
        // You can optionally treat H1 as a chapter or just skip it.
        // We'll treat it as a Chapter if there is none, or just ignore.
        if (!currentChapter) {
            const rawTitle = h1Match[1];
            const title = getUniqueTitle(formatTitleWithPrefix(rawTitle));
            currentChapter = {
              title,
              streamType: 'default',
              streamList: [],
              body: '\n',
            };
            tiddlers.push(currentChapter);
            chapters.push(currentChapter);
            currentPage = null;
        }
    } else if (h2Match) {
      const rawTitle = h2Match[1];
      const title = getUniqueTitle(formatTitleWithPrefix(rawTitle));
      currentChapter = {
        title,
        streamType: 'default',
        streamList: [],
        body: '\n',
      };
      tiddlers.push(currentChapter);
      chapters.push(currentChapter);
      currentPage = null; 
    } else if (h3Match) {
      if (!currentChapter) {
         const title = getUniqueTitle(formatTitleWithPrefix(rootTitle));
         currentChapter = {
           title: title,
           streamType: 'default',
           streamList: [],
           body: '\n',
         };
         tiddlers.push(currentChapter);
         chapters.push(currentChapter);
      }
      
      const rawTitle = h3Match[1];
      const title = getUniqueTitle(formatTitleWithPrefix(rawTitle));
      const parentTitle = currentChapter.title;

      currentPage = {
        title,
        streamType: 'default',
        parent: parentTitle,
        streamList: [],
        body: '\n',
      };
      if (!currentChapter.streamList) currentChapter.streamList = [];
      currentChapter.streamList.push(title);
      tiddlers.push(currentPage);
    } else {
        let trimmedLine = line.trim();
        // Remove leading markdown bullet points (hyphens, asterisks, plus signs)
        trimmedLine = trimmedLine.replace(/^[-*+]\s+/, '');
        
        if (trimmedLine) {
            if (!currentChapter) {
               const title = getUniqueTitle(formatTitleWithPrefix(rootTitle));
               currentChapter = {
                 title: title,
                 streamType: 'default',
                 streamList: [],
                 body: '\n',
               };
               tiddlers.push(currentChapter);
               chapters.push(currentChapter);
            }

            // Treat each block of text as a node with zero-padded format
            const rawTitle = `p${String(globalParagraphCount++).padStart(3, '0')}`;
            const title = getUniqueTitle(formatTitleWithPrefix(rawTitle), true);
            
            const parentTiddler = currentPage || currentChapter;
            
            const node: Tiddler = {
                title,
                streamType: 'default',
                parent: parentTiddler.title,
                body: trimmedLine
            };
            if (!parentTiddler.streamList) parentTiddler.streamList = [];
            parentTiddler.streamList.push(title);
            tiddlers.push(node);
        }
    }
  }

  // Sequential Navigation Logic - ONLY apply prev/next on chapters
  for (let i = 0; i < chapters.length; i++) {
    if (i > 0) {
      chapters[i].prev = chapters[i - 1].title;
    }
    if (i < chapters.length - 1) {
      chapters[i].next = chapters[i + 1].title;
    }
  }

  // Tag the first chapter with 'Dogear'
  if (chapters.length > 0) {
    chapters[0].tags = 'Dogear';
  }

  // Convert tiddlers to string
  const content = tiddlers.map(t => {
    const meta: Record<string, string> = {
      title: t.title,
      'stream-type': t.streamType,
    };
    if (t.tags) meta['tags'] = t.tags;
    if (t.parent) meta['parent'] = t.parent;
    if (t.prev) meta['prev'] = t.prev;
    if (t.next) meta['next'] = t.next;
    if (t.streamList && t.streamList.length > 0) {
      meta['stream-list'] = t.streamList.map(c => `[[${c}]]`).join(' ');
    }

    const sortedKeys = Object.keys(meta).sort();
    let output = sortedKeys.map(k => `${k}: ${meta[k]}`).join('\n');
    
    // Exactly one blank line (two newlines) immediately following the final metadata field.
    output += '\n\n';

    const trimmedBody = t.body.trim();
    if (trimmedBody === '') {
       // Empty Body: The body must contain a single newline, resulting in a triple-newline gap
       output += '\n'; 
    } else {
       // Tiddlers WITH Body Content: The ⁂⁂⁂ separator follows the body immediately
       output += trimmedBody + '\n';
    }
    
    return output;
  }).join('⁂⁂⁂\n');

  if (assets.length === 0) return content;

  // Append assets as tiddlers
  const assetContent = assets.map(asset => {
    const extension = asset.fileName.split('.').pop() || 'png';
    const type = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
    
    // Sort keys alphabetically just like regular tiddlers
    const meta: Record<string, string> = {
      title: asset.fileName.replace(/\s+/g, '_'),
      type: type,
    };

    const sortedKeys = Object.keys(meta).sort();
    let output = sortedKeys.map(k => `${k}: ${meta[k]}`).join('\n');
    
    // Exactly one blank line (two newlines)
    output += '\n\n';
    
    // Body immediately followed by ⁂⁂⁂ (no extra blank line)
    output += `${asset.data}\n`;
    return output;
  }).join('⁂⁂⁂\n');

  return content + '⁂⁂⁂\n' + assetContent;
};
