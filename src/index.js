import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import multer from 'multer'
import printer from 'unix-print'
import { join } from 'path'
import cors from 'cors'
import fs from 'fs'

const app = express()
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}))
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
})

const lobbies = new Map() // Un mapa para almacenar los lobbies creados

app.get('/', (_req, res) => {
  res.send('Servidor express con socket.io')
})

io.on('connection', (socket) => {
  console.log('Un cliente se ha conectado', socket.id)

  // Escuchar eventos personalizados del cliente
  socket.on('createLobby', (jugadores) => {
    const lobbyId = generarPin()

    const lobbyParticipants = jugadores.map((participante) => {
      const particip = {
        ...participante,
        participa: false,
        socket: null,
        respuesta: null,
        acertado: false
      }
      return particip
    })

    const newLobby = {
      id: lobbyId,
      players: lobbyParticipants,
      jugando: false
      // Agrega más propiedades según las necesidades de tu aplicación
    }

    // Agregar el nuevo lobby al mapa de lobbies
    lobbies.set(lobbyId, newLobby)

    // Notificar al cliente que el lobby ha sido creado y enviar el identificador del lobby
    socket.emit('lobbyCreated', lobbyId)

    console.log(`Lobby creado: ${lobbyId}`)
  })

  socket.on('joinLobby', (lobbyId) => {
    console.log('entrando a lobby', lobbyId, 'con socket', socket.id)
    const lobby = lobbies.get(lobbyId.lobbyId)
    if (lobby) {
      console.log('lobby encontrado')
      const user = lobby.players.find(
        (player) => player.cedula === lobbyId.cedula
      )
      if (user) {
        if (user.participa === true) {
          socket.emit('joinError', 'Usuario ya participando')
        } else {
          user.participa = true
          user.socket = socket.id

          socket.join(lobbyId.lobbyId)
          socket.emit('joinedLobby', { ...user, lobbyId: lobbyId.lobbyId })
          io.to(lobbyId.lobbyId).emit('updateLobbyUsers', lobby)
          console.log(
            `Usuario ${user.id} se ha unido a la sala "${lobbyId.lobbyId}"`
          )
          console.log(lobby)
        }
      }
    } else {
      socket.emit('joinedLobby', 'No encontrado')
    }
  })

  socket.on('leaveLobby', (lobbyId) => {
    if (lobbyId !== null) {
      console.log('dejando Lobby', lobbyId)
      const lobby = lobbies.get(lobbyId.lobbyId)
      if (lobby) {
        console.log('lobby encontrado')
        // Eliminar al jugador del lobby
        const user = lobby.players.find(
          (player) => player.cedula === lobbyId.cedula
        )
        if (user) {
          user.participa = false
          user.socket = null

          socket.leave(lobbyId.lobbyId)

          console.log(
            `Usuario ${lobbyId.id} ha dejado la sala "${lobbyId.lobbyId}"`
          )
          console.log(lobby)
          io.to(lobbyId.lobbyId).emit('updateLobbyUsers', lobby)
        }
      }
    }
  })

  socket.on('deleteLobby', (lobbyId) => {
    console.log(lobbyId)
    const lobby = lobbies.get(lobbyId)
    if (lobby) {
      io.to(lobbyId).emit('LobbieDeleted', lobby)
      console.log('Lobby eliminado')
      const del = lobbies.delete(lobbyId)
      if (del) {
        console.log('eliminao')
      }
    }
  })

  socket.on('startTournament', (lobbyId) => {
    console.log(lobbyId)
    console.log('Iniciando Sorteo')
    const lobby = lobbies.get(lobbyId.lobbyId)
    if (lobby) {
      lobby.players = lobby.players.filter(
        (player) => player.participa === true
      )
      lobby.jugando = true
      io.to(lobbyId.lobbyId).emit('updateLobbyUsers', lobby)
      console.log(lobby)
    }

    io.to(lobbyId.lobbyId).emit('startedTournament', { ...lobby, ...lobbyId })
  })

  socket.on('recieveResponse', (response) => {
    console.log(response)
    const lobby = lobbies.get(response.lobbyId)
    if (lobby) {
      if (response.datosSorteo !== null) {
        const user = lobby.players.find(
          (player) => player.cedula === response.cedula
        )
        if (user) {
          user.respuesta = response.respuesta
          if (response.respuesta === response.datosSorteo.opcion_verdadera) {
            user.acertado = true
          } else if (
            response.respuesta !== response.datosSorteo.opcion_verdadera
          ) {
            user.acertado = false
          }
          console.log(lobby)
          io.to(response.lobbyId).emit('updateLobbyUsers', lobby)
        }
      }
    }
  })

  socket.on('finishTournament', (data) => {
    const lobby = lobbies.get(data)
    if (lobby) {
      console.log('sorteon finalizado', lobby)
      lobby.jugando = false
      io.to(data).emit('finishedTournament', lobby)
    }
  })

  // Manejar la desconexión del cliente
  socket.on('disconnect', () => {
    console.log('Un cliente se ha desconectado')
  })
})

function generarPin () {
  let pin = ''
  const caracteres = '0123456789'
  const longitud = 6

  // Generar el pin de 6 caracteres
  for (let i = 0; i < longitud; i++) {
    const indiceAleatorio = Math.floor(Math.random() * caracteres.length)
    pin += caracteres.charAt(indiceAleatorio)
  }

  return pin
}

const upload = multer({ dest: 'temp/' })

app.post('/api/imprimir', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No se ha subido ningún archivo')
  }
  const printers = await printer.getPrinters()
  console.log(printers)

  const filePath = join(process.cwd(), req.file.path)

  try {
    // Imprimir el archivo PDF
    await printer.print(filePath)

    // Eliminar el archivo después de la impresión
    fs.unlink(filePath)

    res.status(200).send('Documento enviado a la impresora')
  } catch (error) {
    console.error('Error al imprimir el archivo:', error)
    res.status(500).send('Error al imprimir el archivo')
  }
})

const PORT = 3060
server.listen(PORT, () => {
  console.log(`Servidor Express con Socket.io escuchando en el puerto ${PORT}`)
})
