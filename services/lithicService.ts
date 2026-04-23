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
  created: string;
  modified: string;
  streamType: string;
  parent?: string;
  streamList?: string[];
  body: string;
}

export const parseMarkdownToLithic = (markdown: string, rootTitle: string = 'Imported Content'): string => {
  const lines = markdown.split('\n');
  const tiddlers: Tiddler[] = [];
  const timestamp = getLithicTimestamp();
  const seenTitles = new Set<string>();

  const getUniqueTitle = (baseTitle: string): string => {
    let title = baseTitle.trim() || 'Untitled Node';
    let counter = 1;
    let uniqueTitle = title;
    while (seenTitles.has(uniqueTitle)) {
      uniqueTitle = `${title} (${counter})`;
      counter++;
    }
    seenTitles.add(uniqueTitle);
    return uniqueTitle;
  };

  // Root Tiddler
  const root: Tiddler = {
    title: getUniqueTitle(rootTitle),
    created: timestamp,
    modified: timestamp,
    streamType: 'default',
    streamList: [],
    body: '\n',
  };
  tiddlers.push(root);

  let currentChapter: Tiddler | null = null;
  let currentPage: Tiddler | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);
    const h3Match = line.match(/^###\s+(.+)$/);

    if (h1Match) {
        // Just skip or update root title if it's the first one
    } else if (h2Match) {
      const title = getUniqueTitle(h2Match[1]);
      currentChapter = {
        title,
        created: timestamp,
        modified: timestamp,
        streamType: 'default',
        parent: root.title,
        streamList: [],
        body: '\n',
      };
      if (!root.streamList) root.streamList = [];
      root.streamList.push(title);
      tiddlers.push(currentChapter);
      currentPage = null; 
    } else if (h3Match) {
      const title = getUniqueTitle(h3Match[1]);
      const parentTitle = currentChapter ? currentChapter.title : root.title;
      const parentTiddler = currentChapter || root;

      currentPage = {
        title,
        created: timestamp,
        modified: timestamp,
        streamType: 'default',
        parent: parentTitle,
        streamList: [],
        body: '\n',
      };
      if (!parentTiddler.streamList) parentTiddler.streamList = [];
      parentTiddler.streamList.push(title);
      tiddlers.push(currentPage);
    } else {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            // Treat each block of text as a node
            const previewText = trimmedLine.length > 50 ? trimmedLine.substring(0, 47) + '...' : trimmedLine;
            const title = getUniqueTitle(previewText);
            const parentTiddler = currentPage || currentChapter || root;
            
            const node: Tiddler = {
                title,
                created: timestamp,
                modified: timestamp,
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

  // Convert tiddlers to string
  return tiddlers.map(t => {
    const meta: Record<string, string> = {
      title: t.title,
      created: t.created,
      modified: t.modified,
      'stream-type': t.streamType,
    };
    if (t.parent) meta['parent'] = t.parent;
    if (t.streamList && t.streamList.length > 0) {
      meta['stream-list'] = t.streamList.map(c => `[[${c}]]`).join(' ');
    }

    const sortedKeys = Object.keys(meta).sort();
    let output = sortedKeys.map(k => `${k}: ${meta[k]}`).join('\n');
    output += '\n\n';

    const trimmedBody = t.body.trim();
    if (trimmedBody === '' || trimmedBody === '\n') {
       output += '\n'; 
    } else {
       output += trimmedBody + '\n';
    }
    
    return output;
  }).join('⁂⁂⁂\n');
};
