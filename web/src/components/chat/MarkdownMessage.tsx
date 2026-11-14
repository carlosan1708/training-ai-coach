import { Box } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Chat content is untrusted. Keep navigation to explicit web/email protocols;
// relative, script and data URLs have no useful destination in a coach reply.
function safeLink(value: string): string {
  try {
    const protocol = new URL(value).protocol;
    return ['https:', 'http:', 'mailto:'].includes(protocol) ? value : '';
  } catch {
    return '';
  }
}

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <Box
      data-testid="assistant-markdown"
      sx={{
        minWidth: 0,
        fontSize: '1rem',
        lineHeight: 1.65,
        overflowWrap: 'anywhere',
        '& > :first-of-type': { mt: 0 },
        '& > :last-of-type': { mb: 0 },
        '& p': { my: 1.25 },
        '& h2, & h3, & h4, & h5, & h6': { mt: 2.25, mb: 1, fontWeight: 750, lineHeight: 1.35 },
        '& h2': { fontSize: '1.3rem' },
        '& h3': { fontSize: '1.16rem' },
        '& h4, & h5, & h6': { fontSize: '1rem' },
        '& ul, & ol': { my: 1.25, pl: 2.75 },
        '& li': { my: 0.5 },
        '& li > p': { my: 0.5 },
        '& a': { color: 'primary.main', textUnderlineOffset: '3px' },
        '& strong': { fontWeight: 750 },
        '& blockquote': { mx: 0, my: 1.5, pl: 2, borderLeft: '3px solid', borderColor: 'primary.light', color: 'text.secondary' },
        '& code': { fontFamily: 'monospace', fontSize: '0.88em', bgcolor: 'action.hover', px: 0.5, py: 0.2, borderRadius: 0.75 },
        '& pre': { maxWidth: '100%', overflowX: 'auto', p: 1.5, bgcolor: 'action.hover', borderRadius: 2 },
        '& pre code': { bgcolor: 'transparent', p: 0, whiteSpace: 'pre', overflowWrap: 'normal' },
        '& hr': { my: 2, border: 0, borderTop: '1px solid', borderColor: 'divider' },
        '& table': { width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
        '& th, & td': { px: 1.5, py: 1, border: '1px solid', borderColor: 'divider', textAlign: 'left', verticalAlign: 'top', minWidth: 100 },
        '& th': { bgcolor: 'action.hover', fontWeight: 700 },
        '& input[type="checkbox"]': { accentColor: 'primary.main' },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeLink}
        components={{
          h1: ({ children }) => <h2>{children}</h2>,
          h2: ({ children }) => <h3>{children}</h3>,
          h3: ({ children }) => <h4>{children}</h4>,
          h4: ({ children }) => <h5>{children}</h5>,
          h5: ({ children }) => <h6>{children}</h6>,
          h6: ({ children }) => <h6>{children}</h6>,
          a: ({ href, children }) => href
            ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
            : <span>{children}</span>,
          // Remote images can track readers. Keep their descriptive text only.
          img: ({ alt }) => <span>{alt}</span>,
          table: ({ children }) => (
            <Box tabIndex={0} sx={{ maxWidth: '100%', overflowX: 'auto', my: 1.5, borderRadius: 1, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
              <table>{children}</table>
            </Box>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
}
