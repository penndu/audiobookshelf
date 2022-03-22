const fs = require('fs-extra')
const Logger = require('../Logger')

const { downloadFile } = require('../utils/fileUtils')
const prober = require('../utils/prober')
const LibraryFile = require('../objects/files/LibraryFile')
const PodcastEpisodeDownload = require('../objects/PodcastEpisodeDownload')
const PodcastEpisode = require('../objects/entities/PodcastEpisode')
const AudioFile = require('../objects/files/AudioFile')

class PodcastManager {
  constructor(db, watcher, emitter) {
    this.db = db
    this.watcher = watcher
    this.emitter = emitter

    this.downloadQueue = []
    this.currentDownload = null
  }

  async downloadPodcastEpisodes(libraryItem, episodesToDownload) {
    var index = 1
    episodesToDownload.forEach((ep) => {
      var newPe = new PodcastEpisode()
      newPe.setData(ep, index++)
      var newPeDl = new PodcastEpisodeDownload()
      newPeDl.setData(newPe, libraryItem)
      this.startPodcastEpisodeDownload(newPeDl)
    })
  }

  async startPodcastEpisodeDownload(podcastEpisodeDownload) {
    if (this.currentDownload) {
      this.downloadQueue.push(podcastEpisodeDownload)
      return
    }
    this.currentDownload = podcastEpisodeDownload

    // Ignores all added files to this dir
    this.watcher.addIgnoreDir(this.currentDownload.libraryItem.path)

    var success = await downloadFile(this.currentDownload.url, this.currentDownload.targetPath).then(() => true).catch((error) => {
      Logger.error(`[PodcastManager] Podcast Episode download failed`, error)
      return false
    })
    if (success) {
      success = await this.scanAddPodcastEpisodeAudioFile()
      if (!success) {
        await fs.remove(this.currentDownload.targetPath)
      } else {
        Logger.info(`[PodcastManager] Successfully downloaded podcast episode "${this.currentDownload.podcastEpisode.title}"`)
      }
    }

    this.watcher.removeIgnoreDir(this.currentDownload.libraryItem.path)
    this.currentDownload = null
    if (this.downloadQueue.length) {
      this.startPodcastEpisodeDownload(this.downloadQueue.shift())
    }
  }

  async scanAddPodcastEpisodeAudioFile() {
    var libraryFile = await this.getLibraryFile(this.currentDownload.targetPath, this.currentDownload.targetRelPath)
    var audioFile = await this.probeAudioFile(libraryFile)
    if (!audioFile) {
      return false
    }

    var libraryItem = this.db.libraryItems.find(li => li.id === this.currentDownload.libraryItem.id)
    if (!libraryItem) {
      Logger.error(`[PodcastManager] Podcast Episode finished but library item was not found ${this.currentDownload.libraryItem.id}`)
      return false
    }
    var podcastEpisode = this.currentDownload.podcastEpisode
    podcastEpisode.audioFile = audioFile
    libraryItem.media.addPodcastEpisode(podcastEpisode)
    libraryItem.updatedAt = Date.now()
    await this.db.updateLibraryItem(libraryItem)
    this.emitter('item_updated', libraryItem.toJSONExpanded())
    return true
  }

  async getLibraryFile(path, relPath) {
    var newLibFile = new LibraryFile()
    await newLibFile.setDataFromPath(path, relPath)
    return newLibFile
  }

  async probeAudioFile(libraryFile) {
    var path = libraryFile.metadata.path
    var audioProbeData = await prober.probe(path)
    if (audioProbeData.error) {
      Logger.error(`[PodcastManager] Podcast Episode downloaded but failed to probe "${path}"`, audioProbeData.error)
      return false
    }
    var newAudioFile = new AudioFile()
    newAudioFile.setDataFromProbe(libraryFile, audioProbeData)
    return newAudioFile
  }
}
module.exports = PodcastManager