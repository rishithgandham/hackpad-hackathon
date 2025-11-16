'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Calendar, User } from 'lucide-react';
import { signOut } from '@/lib/auth-client';

export function Navbar() {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!dropdownRef.current) return;
      if (dropdownRef.current.contains(event.target as Node)) return;
      setIsUserMenuOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <nav className="sticky top-0 z-10 border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-10 max-w-4xl items-center justify-between px-4">
        <span className="text-lg font-semibold text-foreground">AI Task Organizer</span>
        <div className="flex items-center gap-1">
          <Link
            href="/calendar"
            aria-label="Open calendar"
            className="rounded-full bg-card p-2 text-foreground transition hover:text-primary"
          >
            <Calendar className="h-4 w-4" />
          </Link>
          <div ref={dropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
              className="flex h-9 w-9 items-center justify-center rounded-full  bg-card text-foreground transition hover:border-primary"
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
            >
              <User className="h-4 w-4" />
            </button>
            {isUserMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-40 rounded-lg border border-border bg-card p-2 text-sm shadow-lg"
              >
                <button
                  type="button"
                  className="flex w-full items-center rounded-md px-3 py-2 text-left text-foreground hover:bg-muted"
                >
                  Profile
                </button>
                <button
                  type="button"
                  className="flex w-full items-center rounded-md px-3 py-2 text-left text-foreground hover:bg-muted"
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="flex w-full items-center rounded-md px-3 py-2 text-left text-destructive hover:bg-muted"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}


