export const processJsonFile = async (file: File): Promise<string> => {
    const text = await file.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error("Failed to parse JSON file.");
    }

    // Check if it looks like a Reddit structure
    if (Array.isArray(data) && data.length >= 2 && data[0]?.data?.children) {
        return parseRedditJson(data);
    }

    // Fallback naive JSON dump
    return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
};

const parseRedditJson = (data: any[]): string => {
    const postData = data[0]?.data?.children?.[0]?.data;
    const commentsData = data[1]?.data?.children;

    if (!postData) {
        throw new Error("Could not extract Reddit post data.");
    }

    const postTitle = postData.title || "Reddit Post";
    let markdown = `# ${postTitle}\n\n`;
    
    if (postData.author) {
        markdown += `**Posted by u/${postData.author}**\n\n`;
    }

    if (postData.selftext) {
        markdown += `${postData.selftext}\n\n`;
    } else if (postData.url && postData.url !== postData.permalink) {
         markdown += `Link: ${postData.url}\n\n`;
    }

    markdown += `---\n\n## Comments\n\n`;

    const formatComments = (comments: any[], depth = 0): string => {
        if (!comments || comments.length === 0) return '';
        let result = '';

        for (const child of comments) {
            if (child.kind !== 't1') continue; // t1 is a comment
            const comment = child.data;
            if (!comment.author || !comment.body) continue;

            const indent = '> '.repeat(depth) + (depth > 0 ? '' : '');
            
            result += `${indent}**u/${comment.author}**:\n`;
            
            // Indent the comment body
            const bodyLines = comment.body.split('\n');
            for (const line of bodyLines) {
                 result += `${indent}${line}\n`;
            }
            result += `\n`;

            if (comment.replies && comment.replies !== '' && comment.replies.data && comment.replies.data.children) {
                result += formatComments(comment.replies.data.children, depth + 1);
            }
        }

        return result;
    };

    if (commentsData) {
        const parsedComments = formatComments(commentsData, 0);
        markdown += parsedComments || "No comments found.";
    }

    return markdown;
};
