import { ReactNode } from "react"
import { Navbar } from "@/components/layout/navbar"
import { AuthGuard } from "@/components/auth-guard"

// A plain string here would clear the root template for nested routes, which is
// how /tasks/completed lost its " · Planora" suffix.
export const metadata = {
  title: { default: "Tasks", template: "%s · Planora" },
}

export default function TasksLayout({ children }: { children: ReactNode }) {
    return (
        <AuthGuard>
            <div className="min-h-screen bg-transparent">
                <Navbar />
                <main className="pt-20">
                    {/*
                      pb-28 (112px), not the symmetric py-8: the capture control is
                      fixed over the bottom of this scroll region — 56px of bubble,
                      a 16px gutter, 16px of air and the home indicator. Without it
                      the last card is permanently half-covered, which is the item
                      people report as "the one I cannot tap".
                    */}
                    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-5 lg:px-6 pt-8 pb-28">
                        {children}
                    </div>
                </main>
            </div>
        </AuthGuard>
    )
}
