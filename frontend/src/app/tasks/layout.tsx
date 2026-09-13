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
                    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-5 lg:px-6 py-8">
                        {children}
                    </div>
                </main>
            </div>
        </AuthGuard>
    )
}
