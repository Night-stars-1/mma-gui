/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 * @Author: Night-stars-1 nujj1042633805@gmail.com
 * @Date: 2024-09-07 22:51:22
 * @LastEditors: Night-stars-1 nujj1042633805@gmail.com
 * @LastEditTime: 2024-09-10 13:21:20
 */
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import unzipper from 'unzipper'
import { ipcMain, IpcMainEvent } from 'electron'
import { upRes } from './maa'

async function isUpdate() {
  let version = '0'
  try {
    if (!import.meta.env.VITE_MAIN_VERSION) return version
    const response = await axios.get(import.meta.env.VITE_MAIN_VERSION)
    version = response.data.toString()
    const localVersion = fs
      .readFileSync(`${import.meta.env.VITE_MAIN_UNRES_OUT_DIR}/version.txt`, 'utf-8')
      .trim()
    return version !== localVersion ? version : false
  } catch {
    return version
  }
}

async function update(version: string, event: IpcMainEvent) {
  try {
    // 发出 GET 请求，响应类型设置为 arraybuffer 以处理二进制文件
    const response = await axios.get(import.meta.env.VITE_MAIN_RESOURCES, {
      responseType: 'arraybuffer',
      onDownloadProgress: (progressEvent) => {
        const totalLength = progressEvent.total || 1 // 防止 total 为 0
        const progress = (progressEvent.loaded / totalLength) * 100
        event.sender.send('extract-progress', progress.toFixed(2))
      }
    })
    // 将文件写入指定路径
    fs.writeFileSync('res.zip', response.data)
    console.log('资源包下载成功')
    event.sender.send('res-download', `资源包下载完成`)
    extractZip(
      'res.zip',
      import.meta.env.VITE_MAIN_UNRES_TARGET_DIR,
      import.meta.env.VITE_MAIN_UNRES_OUT_DIR,
      version,
      event
    )
  } catch (error: any) {
    console.error('下载资源包时发生错误:', error.message)
  }
}

function extractZip(
  zipPath: string,
  targetDir: string,
  outputDir: string,
  version: string,
  event: IpcMainEvent
) {
  let totalFiles = 0
  let extractedFiles = 0

  fs.mkdirSync(outputDir, { recursive: true })
  try {
    fs.rmSync(path.join(outputDir, 'image'), { recursive: true, force: true })
    console.log(`文件夹 ${path.join(outputDir, 'image')} 删除成功`)
  } catch (err) {
    console.error(`删除文件夹时出错: ${err}`)
  }
  try {
    fs.rmSync(path.join(outputDir, 'pipeline'), { recursive: true, force: true })
    console.log(`文件夹 ${path.join(outputDir, 'pipeline')} 删除成功`)
  } catch (err) {
    console.error(`删除文件夹时出错: ${err}`)
  }

  // 统计 zip 文件中的总文件数
  fs.createReadStream(zipPath)
    .pipe(unzipper.Parse())
    .on('entry', (entry) => {
      if (entry.path.startsWith(`${targetDir}`)) {
        totalFiles++
      }
      entry.autodrain() // 只是统计，不实际处理条目
    })
    .on('close', () => {
      // 开始正式解压
      fs.createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on('entry', (entry) => {
          // 只处理位于目标文件夹的文件
          if (entry.path.startsWith(`${targetDir}`)) {
            const relativePath = entry.path.replace(`${targetDir}`, '') // 去除目标文件夹前缀，使其解压到outputDir的根目录
            const filePath = path.join(outputDir, relativePath)

            // 目录时自动创建目录
            if (entry.type === 'Directory') {
              fs.mkdirSync(filePath, { recursive: true })
              extractedFiles++
              const progress = (extractedFiles / totalFiles) * 100
              event.sender.send('extract-progress', progress.toFixed(2))
              entry.autodrain() // 跳过处理目录流
            } else {
              fs.mkdirSync(path.dirname(filePath), { recursive: true })
              // 文件时，将其解压到指定目录
              entry.pipe(fs.createWriteStream(filePath)).on('finish', () => {
                extractedFiles++
                const progress = (extractedFiles / totalFiles) * 100
                event.sender.send('extract-progress', progress.toFixed(2))
              })
            }
          }
        })
        .on('close', () => {
          if (extractedFiles) {
            fs.writeFileSync(`${outputDir}/version.txt`, version)
            upRes()
          }
          event.sender.send('extract-complete', `解压完成，共解压 ${extractedFiles} 个文件`)
        })
        .on('error', (err: any) => {
          event.sender.send('extract-error', `解压失败: ${err.message}`)
        })
    })
    .on('error', (err: any) => {
      event.sender.send('extract-error', `读取 ZIP 文件失败: ${err.message}`)
    })
}

// 监听渲染进程的请求，执行解压任务
ipcMain.on('res-update', (event, version) => {
  update(version, event)
})

ipcMain.handle('res-is-update', isUpdate)
