import { ICopilotContext } from "@/types/copilot"
import {
	createContext,
	ReactNode,
	useContext,
	useState,
} from "react"
import toast from "react-hot-toast"
import axios from "axios"

const CopilotContext = createContext<ICopilotContext | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export const useCopilot = () => {
	const context = useContext(CopilotContext)

	if (context === null) {
		throw new Error(
			"useCopilot must be used within a CopilotContextProvider",
		)
	}

	return context
}

const CopilotContextProvider = ({
	children,
}: {
	children: ReactNode
}) => {
	const [input, setInput] = useState<string>("")
	const [output, setOutput] = useState<string>("")
	const [isRunning, setIsRunning] = useState<boolean>(false)

	const generateCode = async () => {
		try {
			if (input.trim().length === 0) {
				toast.error("Please write a prompt")
				return
			}

			setIsRunning(true)

			const loadingToast = toast.loading("Generating code...")

			const backendUrl =
				import.meta.env.VITE_BACKEND_URL ||
				"http://localhost:3000"

			const response = await axios.post(
				`${backendUrl}/api/copilot`,
				{
					prompt: input,
				},
			)

			if (response.data?.code) {
				setOutput(response.data.code)

				toast.success("Code generated successfully", {
					id: loadingToast,
				})
			} else {
				toast.error("No code was generated", {
					id: loadingToast,
				})
			}
		} catch (error) {
			console.error("Copilot error:", error)

			toast.error("Failed to generate code")
		} finally {
			setIsRunning(false)
		}
	}

	return (
		<CopilotContext.Provider
			value={{
				setInput,
				output,
				isRunning,
				generateCode,
			}}
		>
			{children}
		</CopilotContext.Provider>
	)
}

export { CopilotContextProvider }

export default CopilotContext