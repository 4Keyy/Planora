"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search, X, Command, Zap, Clock, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Todo } from "@/types/todo"
import { cn } from "@/lib/utils"

interface AdvancedSearchBarProps {
  todos: Todo[]
  value: string
  onChange: (value: string) => void
  onStatusChange: (status: string) => void
  onPriorityChange: (priority: string) => void
  onCategoryChange: (categoryId: string) => void
  categories: Array<{ id: string; name: string; color: string }>
  currentStatus: string
  currentPriority: string
  currentCategory: string
}

const PRIORITY_OPTIONS = [
  { value: "all", label: "All Priorities", icon: Zap, color: "text-ink-subtle" },
  { value: "Critical", label: "Critical", icon: AlertCircle, color: "text-alert" },
  { value: "Urgent", label: "Urgent", icon: AlertCircle, color: "text-warn" },
  { value: "High", label: "High", icon: AlertCircle, color: "text-warn" },
  { value: "Medium", label: "Medium", icon: Zap, color: "text-positive" },
  { value: "Low", label: "Low", icon: Clock, color: "text-accent" },
  { value: "VeryLow", label: "Very Low", icon: Clock, color: "text-ink-subtle" },
]

const STATUS_OPTIONS = [
  { value: "all", label: "All Tasks", badge: "" },
  { value: "Todo,InProgress", label: "Active", badge: "" },
  { value: "Done", label: "Completed", badge: "" },
  { value: "Todo", label: "To Do", badge: "" },
  { value: "InProgress", label: "In Progress", badge: "" },
]

export function AdvancedSearchBar({
  todos,
  value,
  onChange,
  onStatusChange,
  onPriorityChange,
  onCategoryChange,
  categories,
  currentStatus,
  currentPriority,
  currentCategory,
}: AdvancedSearchBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Debounce the search input 200ms before filtering
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 200)
    return () => clearTimeout(debounceRef.current)
  }, [value])

  // Smart search - searches title, description, category, and priority (uses debounced value)
  const matchedTodos = useMemo(() => {
    if (!debouncedSearch.trim()) return todos
    const query = debouncedSearch.toLowerCase()
    return todos.filter(todo =>
      todo.title.toLowerCase().includes(query) ||
      todo.description?.toLowerCase().includes(query) ||
      todo.categoryName?.toLowerCase().includes(query) ||
      String(todo.priority).toLowerCase().includes(query)
    )
  }, [debouncedSearch, todos])

  const handleSearch = useCallback((newValue: string) => {
    onChange(newValue)
  }, [onChange])

  const handleClearSearch = useCallback(() => {
    onChange("")
    setShowAdvanced(false)
  }, [onChange])

  return (
    <div className="space-y-3">
      {/* Main Search Bar */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle">
          <Search className="h-5 w-5" />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && handleClearSearch()}
          placeholder="Search tasks... (Cmd+K for advanced)"
          className="w-full pl-10 pr-10 py-3 bg-paper border border-line rounded-xl placeholder:text-ink-subtle focus:border-ink transition-[color,background-color,border-color,opacity,transform,box-shadow]"
        />
        <AnimatePresence>
          {value && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
            >
              <X className="h-5 w-5" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Quick Filter Chips */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Status Quick Filters */}
        <div className="flex gap-1 flex-wrap">
          {STATUS_OPTIONS.map((status) => (
            <motion.button
              key={status.value}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onStatusChange(status.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-caption font-bold transition-[color,background-color,border-color,opacity,transform,box-shadow]",
                currentStatus === status.value
                  ? "bg-ink text-paper shadow-lg shadow-black/20"
                  : "bg-gray-100 text-ink-muted hover:bg-gray-200"
              )}
            >
              {status.label}
            </motion.button>
          ))}
        </div>

        {/* Advanced Toggle */}
        <Button
          onClick={() => setShowAdvanced(!showAdvanced)}
          variant={showAdvanced ? "default" : "outline"}
          size="sm"
          className="ml-auto rounded-full text-caption"
        >
          <Command className="h-3 w-3 mr-1" />
          Advanced
        </Button>
      </div>

      {/* Advanced Filters */}
      <AnimatePresence>
        {showAdvanced && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3 pt-3 border-t border-line"
          >
            {/* Priority Filter */}
            <div>
              <label className="text-caption font-bold text-ink-muted uppercase tracking-widest">Priority</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {PRIORITY_OPTIONS.map((priority) => (
                  <motion.button
                    key={priority.value}
                    whileHover={{ scale: 1.05 }}
                    onClick={() => onPriorityChange(priority.value)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-caption font-bold transition-[color,background-color,border-color,opacity,transform,box-shadow]",
                      currentPriority === priority.value
                        ? "bg-ink text-paper shadow-lg shadow-black/20"
                        : "bg-gray-100 text-ink-muted hover:bg-gray-200"
                    )}
                  >
                    {priority.label}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Category Filter */}
            {categories.length > 0 && (
              <div>
                <label className="text-caption font-bold text-ink-muted uppercase tracking-widest">Category</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    onClick={() => onCategoryChange("all")}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-caption font-bold transition-[color,background-color,border-color,opacity,transform,box-shadow]",
                      currentCategory === "all"
                        ? "bg-ink text-paper"
                        : "bg-gray-100 text-ink-muted hover:bg-gray-200"
                    )}
                  >
                    All Categories
                  </motion.button>
                  {categories.map((cat) => (
                    <motion.button
                      key={cat.id}
                      whileHover={{ scale: 1.05 }}
                      onClick={() => onCategoryChange(cat.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-caption font-bold transition-[color,background-color,border-color,opacity,transform,box-shadow]",
                        currentCategory === cat.id
                          ? "text-paper"
                          : "text-ink-muted hover:opacity-80"
                      )}
                      style={currentCategory === cat.id ? { backgroundColor: cat.color || "var(--pl-ink)" } : {}}
                    >
                      {cat.name}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {/* Search Stats */}
            <div className="flex items-center justify-between pt-2 text-caption text-ink-subtle">
              <span>{matchedTodos.length} tasks found</span>
              {value && (
                <Button
                  onClick={handleClearSearch}
                  variant="ghost"
                  size="sm"
                  className="text-ink-subtle hover:text-ink"
                >
                  Clear filters
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
