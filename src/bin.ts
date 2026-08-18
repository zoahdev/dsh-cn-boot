/** bin entry for dsh-cn-boot. */

import { main } from './cli.js'

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
})