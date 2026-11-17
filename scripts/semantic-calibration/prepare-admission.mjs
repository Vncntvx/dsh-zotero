/** Pure input export for the fixed-floor admission measurement; no model or network. */
import { prepareAdmissionInputs } from './admission-data.mjs'
import { cli, isMain, options, print } from './dataset.mjs'

if (isMain(import.meta.url))
  cli(async () => {
    const args = options(process.argv.slice(2), ['--help'])
    if (args['--help']) {
      process.stdout.write(
        'node scripts/semantic-calibration/prepare-admission.mjs > INPUT.json\nExports the frozen authored regression inputs and exact catalog identities.\n',
      )
      return
    }
    print(prepareAdmissionInputs())
  })
