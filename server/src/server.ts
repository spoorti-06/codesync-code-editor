import express, { Response, Request } from "express"
import dotenv from "dotenv"
import http from "http"
import cors from "cors"
import { SocketEvent, SocketId } from "./types/socket"
import { USER_CONNECTION_STATUS, User } from "./types/user"
import { Server } from "socket.io"
import path from "path"
import { GoogleGenAI } from "@google/genai"

dotenv.config()

const app = express()

// Gemini AI client
const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY,
})

app.use(express.json())

app.use(cors())

app.use(express.static(path.join(__dirname, "public"))) // Serve static files

const server = http.createServer(app)

const io = new Server(server, {
	cors: {
		origin: "*",
	},
	maxHttpBufferSize: 1e8,
	pingTimeout: 60000,
})

let userSocketMap: User[] = []

// Function to get all users in a room
function getUsersInRoom(roomId: string): User[] {
	return userSocketMap.filter((user) => user.roomId == roomId)
}

// Function to get room id by socket id
function getRoomId(socketId: SocketId): string | null {
	const roomId = userSocketMap.find(
		(user) => user.socketId === socketId
	)?.roomId

	if (!roomId) {
		console.error("Room ID is undefined for socket ID:", socketId)
		return null
	}

	return roomId
}

function getUserBySocketId(socketId: SocketId): User | null {
	const user = userSocketMap.find((user) => user.socketId === socketId)

	if (!user) {
		console.error("User not found for socket ID:", socketId)
		return null
	}

	return user
}

// ======================================================
// GEMINI COPILOT API
// ======================================================

app.post("/api/copilot", async (req: Request, res: Response) => {
	try {
		const { prompt } = req.body

		if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
			return res.status(400).json({
				error: "Please provide a prompt",
			})
		}

		const response = await ai.models.generateContent({
			model: "gemini-3.8-flash",
			contents: prompt,
			config: {
				systemInstruction:
					"You are a code generation copilot for a project called Code-Sync. Generate only the requested code. Do not provide explanations, introductions, or conclusions. Return clean code suitable for directly placing into a code editor. Use the appropriate programming language based on the user's request.",
			},
		})

		return res.json({
			code: response.text,
		})
	} catch (error) {
		console.error("Gemini API error:", error)

		return res.status(500).json({
			error: "Failed to generate code",
		})
	}
})

// ======================================================
// SOCKET.IO
// ======================================================

io.on("connection", (socket) => {
	// Handle user actions
	socket.on(SocketEvent.JOIN_REQUEST, ({ roomId, username }) => {
		// Check if username exists in the room
		const isUsernameExist = getUsersInRoom(roomId).filter(
			(u) => u.username === username
		)

		if (isUsernameExist.length > 0) {
			io.to(socket.id).emit(SocketEvent.USERNAME_EXISTS)
			return
		}

		const user = {
			username,
			roomId,
			status: USER_CONNECTION_STATUS.ONLINE,
			cursorPosition: 0,
			typing: false,
			socketId: socket.id,
			currentFile: null,
		}

		userSocketMap.push(user)

		socket.join(roomId)

		socket.broadcast.to(roomId).emit(SocketEvent.USER_JOINED, { user })

		const users = getUsersInRoom(roomId)

		io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, {
			user,
			users,
		})
	})

	socket.on("disconnecting", () => {
		const user = getUserBySocketId(socket.id)

		if (!user) return

		const roomId = user.roomId

		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.USER_DISCONNECTED, { user })

		userSocketMap = userSocketMap.filter(
			(u) => u.socketId !== socket.id
		)

		socket.leave(roomId)
	})

	// ======================================================
	// FILE ACTIONS
	// ======================================================

	socket.on(
		SocketEvent.SYNC_FILE_STRUCTURE,
		({ fileStructure, openFiles, activeFile, socketId }) => {
			io.to(socketId).emit(SocketEvent.SYNC_FILE_STRUCTURE, {
				fileStructure,
				openFiles,
				activeFile,
			})
		}
	)

	socket.on(
		SocketEvent.DIRECTORY_CREATED,
		({ parentDirId, newDirectory }) => {
			const roomId = getRoomId(socket.id)

			if (!roomId) return

			socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_CREATED, {
				parentDirId,
				newDirectory,
			})
		}
	)

	socket.on(SocketEvent.DIRECTORY_UPDATED, ({ dirId, children }) => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_UPDATED, {
			dirId,
			children,
		})
	})

	socket.on(SocketEvent.DIRECTORY_RENAMED, ({ dirId, newName }) => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_RENAMED, {
			dirId,
			newName,
		})
	})

	socket.on(SocketEvent.DIRECTORY_DELETED, ({ dirId }) => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.DIRECTORY_DELETED, { dirId })
	})

	socket.on(SocketEvent.FILE_CREATED, ({ parentDirId, newFile }) => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.FILE_CREATED, {
				parentDirId,
				newFile,
			})
	})

	socket.on(SocketEvent.FILE_UPDATED, ({ fileId, newContent }) => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.FILE_UPDATED, {
			fileId,
			newContent,
		})
	})

	socket.on(SocketEvent.FILE_RENAMED, ({ fileId, newName }) => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.FILE_RENAMED, {
			fileId,
			newName,
		})
	})

	socket.on(SocketEvent.FILE_DELETED, ({ fileId }) => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.FILE_DELETED, {
			fileId,
		})
	})

	// ======================================================
	// USER STATUS
	// ======================================================

	socket.on(SocketEvent.USER_OFFLINE, ({ socketId }) => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socketId) {
				return {
					...user,
					status: USER_CONNECTION_STATUS.OFFLINE,
				}
			}

			return user
		})

		const roomId = getRoomId(socketId)

		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.USER_OFFLINE, {
			socketId,
		})
	})

	socket.on(SocketEvent.USER_ONLINE, ({ socketId }) => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socketId) {
				return {
					...user,
					status: USER_CONNECTION_STATUS.ONLINE,
				}
			}

			return user
		})

		const roomId = getRoomId(socketId)

		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.USER_ONLINE, {
			socketId,
		})
	})

	// ======================================================
	// CHAT
	// ======================================================

	socket.on(SocketEvent.SEND_MESSAGE, ({ message }) => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.RECEIVE_MESSAGE, { message })
	})

	// ======================================================
	// CURSOR / TYPING
	// ======================================================

	socket.on(
		SocketEvent.TYPING_START,
		({ cursorPosition, selectionStart, selectionEnd }) => {
			userSocketMap = userSocketMap.map((user) => {
				if (user.socketId === socket.id) {
					return {
						...user,
						typing: true,
						cursorPosition,
						selectionStart,
						selectionEnd,
					}
				}

				return user
			})

			const user = getUserBySocketId(socket.id)

			if (!user) return

			const roomId = user.roomId

			socket.broadcast.to(roomId).emit(SocketEvent.TYPING_START, {
				user,
			})
		}
	)

	socket.on(SocketEvent.TYPING_PAUSE, () => {
		userSocketMap = userSocketMap.map((user) => {
			if (user.socketId === socket.id) {
				return {
					...user,
					typing: false,
				}
			}

			return user
		})

		const user = getUserBySocketId(socket.id)

		if (!user) return

		const roomId = user.roomId

		socket.broadcast.to(roomId).emit(SocketEvent.TYPING_PAUSE, {
			user,
		})
	})

	socket.on(
		SocketEvent.CURSOR_MOVE,
		({ cursorPosition, selectionStart, selectionEnd }) => {
			userSocketMap = userSocketMap.map((user) => {
				if (user.socketId === socket.id) {
					return {
						...user,
						cursorPosition,
						selectionStart,
						selectionEnd,
					}
				}

				return user
			})

			const user = getUserBySocketId(socket.id)

			if (!user) return

			const roomId = user.roomId

			socket.broadcast.to(roomId).emit(SocketEvent.CURSOR_MOVE, {
				user,
			})
		}
	)

	// ======================================================
	// DRAWING
	// ======================================================

	socket.on(SocketEvent.REQUEST_DRAWING, () => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast
			.to(roomId)
			.emit(SocketEvent.REQUEST_DRAWING, {
				socketId: socket.id,
			})
	})

	socket.on(SocketEvent.SYNC_DRAWING, ({ drawingData, socketId }) => {
		socket.broadcast
			.to(socketId)
			.emit(SocketEvent.SYNC_DRAWING, {
				drawingData,
			})
	})

	socket.on(SocketEvent.DRAWING_UPDATE, ({ snapshot }) => {
		const roomId = getRoomId(socket.id)

		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.DRAWING_UPDATE, {
			snapshot,
		})
	})
})

// ======================================================
// SERVER
// ======================================================

const PORT = process.env.PORT || 3000

app.get("/", (req: Request, res: Response) => {
	res.sendFile(
		path.join(__dirname, "..", "public", "index.html")
	)
})

server.listen(PORT, () => {
	console.log(`Listening on port ${PORT}`)
})