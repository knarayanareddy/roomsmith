package com.roomsmith.puzzle

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

private const val MAX_SNAPSHOT_STRING_BYTES = 16_384

/**
 * Atomic value-only fixture storage. Completed remote puzzles, hints, and active
 * time are retained; transient hold timers intentionally restart after reopen.
 */
class RemoteEpisodeFileStore(private val path: Path) {
    fun save(snapshot: RemoteEpisodeSnapshot) {
        validateRemoteSnapshot(snapshot)
        val payload = ByteArrayOutputStream()
        DataOutputStream(payload).use { output ->
            output.writeLong(snapshot.engineState.stateSequence)
            val completions = snapshot.engineState.completedPuzzles.values.sortedBy { it.committedSequence }
            output.writeInt(completions.size)
            completions.forEach { completion ->
                output.writeString(completion.puzzleId)
                output.writeString(completion.path.name)
                output.writeLong(completion.committedSequence)
                output.writeNullableLong(completion.observationSequence)
            }
            output.writeInt(snapshot.hintsUsed.size)
            snapshot.hintsUsed.toSortedMap().forEach { (puzzleId, level) ->
                output.writeString(puzzleId)
                output.writeInt(level)
            }
            output.writeLong(snapshot.activeTimeMs)
        }
        atomicReplace(envelope(payload.toByteArray()))
    }

    fun load(): RemoteEpisodeSnapshot {
        if (Files.size(path) > MAX_SNAPSHOT_BYTES) throw IOException("Snapshot exceeds the fixture size limit")
        val bytes = Files.readAllBytes(path)
        val payload = DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            val magic = ByteArray(MAGIC.size)
            input.readFully(magic)
            if (!magic.contentEquals(MAGIC)) throw IOException("Snapshot magic is invalid")
            if (input.readInt() != FORMAT_VERSION) throw IOException("Snapshot format version is unsupported")
            val payloadSize = input.readInt()
            if (payloadSize < 0 || payloadSize > MAX_SNAPSHOT_BYTES) {
                throw IOException("Snapshot payload length is invalid")
            }
            val expectedDigest = ByteArray(DIGEST_BYTES)
            input.readFully(expectedDigest)
            val value = input.readNBytes(payloadSize)
            if (value.size != payloadSize || input.available() != 0) {
                throw IOException("Snapshot is truncated or has trailing bytes")
            }
            val actualDigest = MessageDigest.getInstance("SHA-256").digest(value)
            if (!MessageDigest.isEqual(expectedDigest, actualDigest)) {
                throw IOException("Snapshot checksum is invalid")
            }
            value
        }
        val snapshot = DataInputStream(ByteArrayInputStream(payload)).use { input ->
            val stateSequence = input.readLong()
            val completions = input.readCount("completions", MAX_RECORDS).let { count ->
                buildMap {
                    repeat(count) {
                        val puzzleId = input.readString()
                        val path = input.readEnum<CompletionPath>()
                        val committedSequence = input.readLong()
                        val observationSequence = input.readNullableLong()
                        val completion = CompletedPuzzle(
                            puzzleId,
                            path,
                            committedSequence,
                            observationSequence
                        )
                        if (put(puzzleId, completion) != null) throw IOException("Duplicate completion key")
                    }
                }
            }
            val hints = input.readCount("hints", MAX_RECORDS).let { count ->
                buildMap {
                    repeat(count) {
                        val puzzleId = input.readString()
                        val level = input.readInt()
                        if (put(puzzleId, level) != null) throw IOException("Duplicate hint key")
                    }
                }
            }
            val activeTimeMs = input.readLong()
            if (input.available() != 0) throw IOException("Snapshot payload has trailing bytes")
            RemoteEpisodeSnapshot(
                engineState = EngineState(stateSequence, completions),
                hintsUsed = hints,
                activeTimeMs = activeTimeMs
            )
        }
        validateRemoteSnapshot(snapshot)
        return snapshot
    }

    private fun envelope(payload: ByteArray): ByteArray {
        val output = ByteArrayOutputStream()
        DataOutputStream(output).use { stream ->
            stream.write(MAGIC)
            stream.writeInt(FORMAT_VERSION)
            stream.writeInt(payload.size)
            stream.write(MessageDigest.getInstance("SHA-256").digest(payload))
            stream.write(payload)
        }
        return output.toByteArray()
    }

    private fun atomicReplace(bytes: ByteArray) {
        val absolute = path.toAbsolutePath()
        val parent = absolute.parent ?: throw IOException("Snapshot must have a parent directory")
        Files.createDirectories(parent)
        val temporary = Files.createTempFile(parent, ".${absolute.fileName}-", ".tmp")
        try {
            Files.write(temporary, bytes)
            try {
                Files.move(
                    temporary,
                    absolute,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING
                )
            } catch (error: AtomicMoveNotSupportedException) {
                throw IOException("Atomic snapshot replacement is unavailable", error)
            }
        } finally {
            Files.deleteIfExists(temporary)
        }
    }

    private companion object {
        val MAGIC = "ROOMEP1".toByteArray(Charsets.UTF_8)
        const val FORMAT_VERSION = 1
        const val DIGEST_BYTES = 32
        const val MAX_SNAPSHOT_BYTES = 1_048_576
        const val MAX_RECORDS = 10_000
    }
}

private fun DataOutputStream.writeString(value: String) {
    val bytes = value.toByteArray(Charsets.UTF_8)
    require(bytes.size <= MAX_SNAPSHOT_STRING_BYTES) { "Snapshot string exceeds the fixture limit" }
    writeInt(bytes.size)
    write(bytes)
}

private fun DataOutputStream.writeNullableLong(value: Long?) {
    writeBoolean(value != null)
    if (value != null) writeLong(value)
}

private fun DataInputStream.readString(): String {
    val size = readInt()
    if (size < 0 || size > MAX_SNAPSHOT_STRING_BYTES) throw IOException("Snapshot string length is invalid")
    val bytes = readNBytes(size)
    if (bytes.size != size) throw IOException("Snapshot string is truncated")
    return String(bytes, Charsets.UTF_8)
}

private fun DataInputStream.readNullableLong(): Long? = if (readBoolean()) readLong() else null

private fun DataInputStream.readCount(label: String, maximum: Int): Int {
    val count = readInt()
    if (count < 0 || count > maximum) throw IOException("Snapshot $label count is invalid")
    return count
}

private inline fun <reified T : Enum<T>> DataInputStream.readEnum(): T {
    val value = readString()
    return runCatching { enumValueOf<T>(value) }.getOrElse {
        throw IOException("Snapshot enum value is invalid", it)
    }
}
