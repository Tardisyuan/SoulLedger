"use client";

import { useState } from "react";
import {
  Home, Menu, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, CornerDownLeft, CornerDownRight,
  ArrowUpRight, ArrowDownLeft, ExternalLink, Link, RefreshCw,
  User, Users, UserPlus, UserCheck, UserX,
  Bell, BellRing, Calendar, Clock, Mail, Inbox,
  Settings, Sliders, Puzzle, Plug,
  Bookmark, Star, Heart, Flag, Tag, Hash, AtSign,
  Plus, Minus, X, Check, Search, Filter, SortAsc, SortDesc,
  Edit, Edit2, Edit3, Pencil, Trash, Trash2, Copy, Clipboard,
  Download, Upload, Save, Share, Share2,
  ZoomIn, ZoomOut, Maximize2, Minimize2, Eye, EyeOff,
  Lock, Unlock, Key, Shield, ShieldCheck, ShieldAlert,
  CheckCircle, CheckCircle2, XCircle, AlertCircle, AlertTriangle,
  Info, HelpCircle, MessageSquare, MessageCircle,
  ThumbsUp, ThumbsDown, TrendingUp, TrendingDown,
  Activity, Zap, FlashlightIcon, Battery, Wifi, WifiOff,
  Skull, Ghost, Sparkles, Wand, Flame, Droplet,
  Sun, Moon, Cloud, Wind, Feather, Leaf,
  Scale, Award, Crown, Gem, Swords,
  Anchor, Sailboat, Compass, Map, Globe, Plane,
  File, FileText, FileCheck, FileX, Folder, FolderOpen,
  FolderPlus, Archive, Package, Box, Database,
  HardDrive, Server, Cpu, Monitor, Smartphone,
  Layout, Grid, List, Sidebar, Columns, Layers,
  KeyRound, LockKeyhole, ShieldPlus, ShieldMinus,
  UserCog, UsersRound,
  Building, Building2, Store,
  BarChart, BarChart2, PieChart,
  Terminal, Code, Code2, FileCode, FileJson,
  type LucideIcon,
} from "lucide-react";
import { BaseModal } from "@/src/components/ui/Modal";

interface IconPickerProps {
  value: string;
  onChange: (iconName: string) => void;
}

interface IconCategory {
  label: string;
  icons: LucideIcon[];
}

const ICON_CATEGORIES: IconCategory[] = [
  {
    label: "navigation",
    icons: [
      Home, Menu, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight,
      ChevronsLeft, ChevronsRight, CornerDownLeft, CornerDownRight,
      ArrowUpRight, ArrowDownLeft, ExternalLink, Link, RefreshCw,
    ],
  },
  {
    label: "general",
    icons: [
      User, Users, UserPlus, UserCheck, UserX,
      Bell, BellRing, Calendar, Clock, Mail, Inbox,
      Settings, Sliders, Puzzle, Plug,
      Bookmark, Star, Heart, Flag, Tag, Hash, AtSign,
    ],
  },
  {
    label: "actions",
    icons: [
      Plus, Minus, X, Check, Search, Filter, SortAsc, SortDesc,
      Edit, Edit2, Edit3, Pencil, Trash, Trash2, Copy, Clipboard,
      Download, Upload, Save, Share, Share2,
      ZoomIn, ZoomOut, Maximize2, Minimize2, Eye, EyeOff,
      Lock, Unlock, Key, Shield, ShieldCheck, ShieldAlert,
    ],
  },
  {
    label: "status",
    icons: [
      CheckCircle, CheckCircle2, XCircle, AlertCircle, AlertTriangle,
      Info, HelpCircle, MessageSquare, MessageCircle,
      ThumbsUp, ThumbsDown, TrendingUp, TrendingDown,
      Activity, Zap, FlashlightIcon, Battery, Wifi, WifiOff,
    ],
  },
  {
    label: "soul",
    icons: [
      Skull, Ghost, Sparkles, Wand, Flame, Droplet,
      Sun, Moon, Cloud, Wind, Feather, Leaf,
      Scale, Award, Crown, Gem, Swords,
      Anchor, Sailboat, Compass, Map, Globe, Plane,
    ],
  },
  {
    label: "files",
    icons: [
      File, FileText, FileCheck, FileX, Folder, FolderOpen,
      FolderPlus, Archive, Package, Box, Database,
      HardDrive, Server, Cpu, Monitor, Smartphone,
      Layout, Grid, List, Sidebar, Columns, Layers,
    ],
  },
  {
    label: "admin",
    icons: [
      KeyRound, LockKeyhole, ShieldPlus, ShieldMinus,
      UserCog, UsersRound,
      Building, Building2, Store,
      BarChart, BarChart2, PieChart,
      Terminal, Code, Code2, FileCode, FileJson,
    ],
  },
];

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("navigation");
  const [search, setSearch] = useState("");

  // Find the selected icon component
  let SelectedIcon: LucideIcon | null = null;
  if (value) {
    for (const cat of ICON_CATEGORIES) {
      const found = cat.icons.find((icon) => icon.displayName === value);
      if (found) {
        SelectedIcon = found;
        break;
      }
    }
  }

  // Search across all icons
  const searchResults = search
    ? ICON_CATEGORIES.flatMap((c) => c.icons).filter((icon) =>
        icon.displayName?.toLowerCase().includes(search.toLowerCase())
      )
    : [];

  const displayCategory = ICON_CATEGORIES.find((c) => c.label === activeCategory);
  const displayIcons = search ? searchResults : (displayCategory?.icons ?? []);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-hairline rounded-md text-sm text-ink hover:border-amber-500 transition-colors min-w-[120px]"
        >
          {SelectedIcon ? (
            <SelectedIcon className="w-4 h-4 text-amber-400" />
          ) : (
            <span className="text-ink-muted">选择图标</span>
          )}
          {value && <span className="text-ink-subtle ml-auto text-xs">{value}</span>}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-ink-muted hover:text-red-400 text-xs"
          >
            清除
          </button>
        )}
      </div>

      <BaseModal
        isOpen={isOpen}
        onClose={() => { setIsOpen(false); setSearch(""); }}
        title="选择图标"
      >
        <div className="space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索图标..."
            className="w-full bg-surface-2 border border-hairline rounded-md px-3 py-2 text-sm text-ink focus:outline-none focus:border-amber-500"
          />

          {!search && (
            <div className="flex flex-wrap gap-1">
              {ICON_CATEGORIES.map((cat) => (
                <button
                  key={cat.label}
                  type="button"
                  onClick={() => setActiveCategory(cat.label)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    activeCategory === cat.label
                      ? "bg-amber-500 text-black"
                      : "bg-surface-2 text-ink-muted hover:text-ink"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-8 gap-1 max-h-64 overflow-y-auto">
            {displayIcons.map((icon) => {
              const isSelected = value === icon.displayName;
              return (
                <button
                  key={icon.displayName}
                  type="button"
                  onClick={() => {
                    if (icon.displayName) onChange(icon.displayName);
                    setIsOpen(false);
                    setSearch("");
                  }}
                  title={icon.displayName ?? ""}
                  className={`flex items-center justify-center w-9 h-9 rounded transition-colors ${
                    isSelected
                      ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500"
                      : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {(() => {
                    const Icon = icon as LucideIcon;
                    return <Icon className="w-4 h-4" />;
                  })()}
                </button>
              );
            })}
          </div>

          {displayIcons.length === 0 && (
            <p className="text-center text-ink-muted text-sm py-4">没有找到图标</p>
          )}
        </div>
      </BaseModal>
    </>
  );
}
