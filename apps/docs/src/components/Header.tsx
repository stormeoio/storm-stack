import { Link, useLocation } from "wouter";
import { Zap, Github } from "lucide-react";
import { clsx } from "clsx";

const NAV = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/cli", label: "CLI" },
  { href: "/plugins", label: "Plugins" },
];

export function Header() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-8">
        <Link href="/" className="flex items-center gap-2 font-bold text-storm-700">
          <Zap size={18} />
          Storm Stack
        </Link>

        <nav className="flex items-center gap-6 flex-1">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "text-sm font-medium transition-colors",
                location.startsWith(href) ? "text-storm-700" : "text-gray-600 hover:text-gray-900",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <a
            href="https://github.com/stormeoio/storm-stack"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-gray-900 transition-colors"
          >
            <Github size={18} />
          </a>
          <code className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-mono">
            npx @stormeoio/create-storm-app
          </code>
        </div>
      </div>
    </header>
  );
}
