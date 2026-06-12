import { ReactNode } from "react"
import { Navbar } from "@/components/layout/navbar"
import { AuthGuard } from "@/components/auth-guard"

export default function BranchLayout({ children }: { children: ReactNode }) {
    return (
        <AuthGuard>
            <div className="min-h-screen bg-transparent">
                <Navbar />
                <main className="pt-20">
                    {/* Same gutters as the rest of the app (tasks/dashboard) so the branch page
                        lines up edge-to-edge with the normal pages. */}
                    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-5 lg:px-6 py-8">
                        {children}
                    </div>
                </main>
            </div>
        </AuthGuard>
    )
}
