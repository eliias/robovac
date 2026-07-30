pipeline {
  agent any

  options {
    disableConcurrentBuilds()
    parallelsAlwaysFailFast()
    retry(1)
    skipStagesAfterUnstable()
    timeout(time: 30, unit: 'MINUTES')
  }

  stages {
    stage("Environment") {
      steps {
        script {
          def branchName = env.BRANCH_NAME.toString().hashCode()
          def gitCommit = env.GIT_COMMIT.toString()
          env.BUILD_TAG = branchName + "_" + gitCommit
        }
      }
    }

    stage("Build test image") {
      steps {
        // The test target holds deps + source but no next build; lint and
        // tests run against it, the production image builds from the same
        // Dockerfile in the deploy stage.
        sh label: 'build', script: ''' #!/usr/bin/env bash
        set -euo pipefail

        sudo docker build \
          --target test \
          -t "robovac-test:$BUILD_TAG" \
          .
        '''
      }
    }

    stage("Lint") {
      steps {
        sh label: 'oxlint', script: ''' #!/usr/bin/env bash
        set -euo pipefail

        sudo docker run --rm \
          "robovac-test:$BUILD_TAG" \
          pnpm run lint
        '''

        sh label: 'oxfmt', script: ''' #!/usr/bin/env bash
        set -euo pipefail

        sudo docker run --rm \
          "robovac-test:$BUILD_TAG" \
          pnpm run format:check
        '''
      }
    }

    stage("Tests") {
      steps {
        // The container is deliberately not --rm: the coverage report is copied
        // out of it afterwards. Test failures are held in $status so the report
        // is still extracted, then re-raised.
        sh label: 'test', script: ''' #!/usr/bin/env bash
        set -uo pipefail

        status=0
        sudo docker run \
          --name "robovac-$BUILD_TAG-test" \
          "robovac-test:$BUILD_TAG" \
          pnpm test --coverage || status=$?

        # copy code coverage report
        ID=$(sudo docker ps -aqf "name=robovac-$BUILD_TAG-test")
        sudo docker cp "$ID:/app/coverage/cobertura-coverage.xml" coverage.xml

        # fix paths in coverage.xml
        sed -i 's|/app|.|g' coverage.xml

        exit $status
        '''
      }
    }

    stage("Publish test results") {
      steps {
        // No qualityGates yet: read the percentage off the first few green
        // builds, then add gates. An unstable result would skip the deploy
        // stage below (skipStagesAfterUnstable).
        recordCoverage(tools: [[parser: 'COBERTURA', pattern: 'coverage.xml']],
          id: 'cobertura', name: 'Coverage Results',
          sourceCodeRetention: 'EVERY_BUILD',
          enabledForFailure: true,
          failOnError: false,
          ignoreParsingErrors: true,
          skipPublishingChecks: true
        )
      }
    }

    stage("Deploy") {
      when {
        branch 'main'
      }

      steps {
        sh label: 'build', script: ''' #!/usr/bin/env bash
        set -euo pipefail

        # build and tag release artifact
        sudo docker build -t registry.conc.at/robovac/robovac:$BUILD_NUMBER .
        sudo docker push registry.conc.at/robovac/robovac:$BUILD_NUMBER
        '''

        sh label: 'deploy', script: ''' #!/usr/bin/env bash
        set -euo pipefail

        # deploy
        ssh dokku@projects.conc.at "git:from-image robovac registry.conc.at/robovac/robovac:$BUILD_NUMBER"
        '''
      }
    }
  }

  post {
    always {
      // Never fail the build from cleanup -- BUILD_TAG is unset if the first
      // stage itself failed, and there may be nothing to tear down.
      sh label: 'cleanup', script: ''' #!/usr/bin/env bash

      sudo docker rm -f "robovac-$BUILD_TAG-test" || true
      sudo docker rmi -f "robovac-test:$BUILD_TAG" || true
      '''
    }
  }
}
