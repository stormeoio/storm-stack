import { Link, useParams } from "wouter";
import { clsx } from "clsx";
import { CONTENT, SECTIONS } from "./docsContent";

export function DocsPage() {
  const params = useParams<{ section?: string }>();
  const activeSection = params.section ?? "getting-started";
  const content = CONTENT[activeSection];

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 flex gap-12">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 hidden md:block">
        <nav className="sticky top-20 space-y-1">
          {SECTIONS.map(({ id, label }) => (
            <Link
              key={id}
              href={`/docs/${id}`}
              className={clsx(
                "block px-3 py-1.5 text-sm rounded-md transition-colors",
                activeSection === id
                  ? "bg-storm-50 text-storm-700 font-medium"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0">
        {content ? (
          <article className="prose prose-gray prose-sm max-w-none prose-headings:font-semibold prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">{content.title}</h1>
            <div className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">
              {content.body}
            </div>
          </article>
        ) : (
          <p className="text-gray-500 text-sm">Section not found.</p>
        )}
      </main>
    </div>
  );
}
